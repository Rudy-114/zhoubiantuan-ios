import SwiftUI
import UIKit

@MainActor
final class MockAppStore: ObservableObject {
    // MARK: - Published State
    @Published var users: [User]
    @Published var posts: [GroupBuyPost]
    @Published var collections: [GroupCollection]
    @Published var reviews: [ReviewPost]
    @Published var comments: [Comment]
    @Published var threads: [MessageThread] {
        didSet {
            persistThreads()
        }
    }
    @Published var moderationReviews: [ModerationReview]
    @Published var reports: [Report]
    @Published var reminders: [Reminder]
    @Published var likedPostIDs: Set<String>
    @Published var favoritePostIDs: Set<String>
    @Published var followedUserIDs: Set<String>
    @Published var followingIDsByUserID: [String: Set<String>]
    @Published var blockedUserIDs: Set<String> = []
    @Published var blockedByUserIDs: Set<String> = []
    @Published var browsingHistoryIDs: [String] {
        didSet {
            UserDefaults.standard.set(browsingHistoryIDs, forKey: Self.browsingHistoryDefaultsKey(for: currentUserID))
        }
    }
    @Published var searchHistory: [String] {
        didSet {
            UserDefaults.standard.set(searchHistory, forKey: Self.searchHistoryDefaultsKey)
        }
    }
    @Published var toastMessage: String?
    @Published var isAuthPromptPresented = false
    @Published var isLoggedIn: Bool {
        didSet {
            UserDefaults.standard.set(isLoggedIn, forKey: Self.loginDefaultsKey)
        }
    }
    @Published var currentUserID = "u-me"
    @Published var authSessionVersion = UUID()
    @Published private(set) var isLoadingInitialFeed = false
    @Published var isDarkModeEnabled: Bool {
        didSet {
            UserDefaults.standard.set(isDarkModeEnabled, forKey: Self.darkModeDefaultsKey)
        }
    }
    @Published var limitsUnrepliedMessages: Bool {
        didSet {
            UserDefaults.standard.set(limitsUnrepliedMessages, forKey: Self.messageLimitDefaultsKey)
        }
    }
    @Published var isBackendEnabled: Bool {
        didSet {
            UserDefaults.standard.set(isBackendEnabled, forKey: Self.backendEnabledDefaultsKey)
        }
    }

    // MARK: - Storage and Configuration

    private static let demoUserID = "u-me"
    private static let loginDefaultsKey = "zhoubiantuan.isLoggedIn"
    private static let darkModeDefaultsKey = "zhoubiantuan.isDarkModeEnabled"
    private static let messageLimitDefaultsKey = "zhoubiantuan.limitsUnrepliedMessages"
    private static let legacyMessageLimitDefaultDisabledMigrationKey = "zhoubiantuan.limitsUnrepliedMessages.defaultDisabled.v1"
    private static let messageLimitDefaultRestoredMigrationKey = "zhoubiantuan.limitsUnrepliedMessages.defaultRestored.v1"
    private static let backendEnabledDefaultsKey = "zhoubiantuan.isBackendEnabled"
    private static let backendTokenDefaultsKey = "zhoubiantuan.backendToken"
    private static let backendTokenFallbackDefaultsKey = "zhoubiantuan.backendToken.fallback"
    private static let browsingHistoryDefaultsKeyPrefix = "zhoubiantuan.browsingHistory"
    private static let messageThreadsDefaultsKey = "zhoubiantuan.messageThreads"
    private static let searchHistoryDefaultsKey = "zhoubiantuan.searchHistory"
    private static let localDataResetDefaultsKey = "zhoubiantuan.localDataResetVersion"
    private static let currentLocalDataResetVersion = 1
    private static let backendFallbackRefreshIntervalNanoseconds: UInt64 = 3_000_000_000
    private static let backendFallbackGraceInterval: TimeInterval = 3
    let backendClient: AliyunBackendClient
    private let persistsData: Bool
    private let automaticallyRefresh: Bool
    private var cachedBackendToken: String?
    private var isRestoringThreads = false
    private var backendRefreshTask: Task<Void, Never>?
    private var refreshRequestID: UUID?
    private var syncRequestID: UUID?
    private var feedRequestID: UUID?
    private var isRefreshingFromBackend: Bool { refreshRequestID != nil }
    private var isSyncingFromBackend: Bool { syncRequestID != nil }
    private var sessionTasks: [UUID: Task<Void, Never>] = [:]
    private var authenticationAttempt = UUID()
    var moderationRequestID: UUID?
    private var realtimeConnection: RealtimeConnection?
    private var isRealtimeConnected = false
    private var lastRealtimeActivityAt = Date.distantPast
    var backendToken: String? {
        get {
            if !persistsData { return cachedBackendToken }
            if let cachedBackendToken {
                return cachedBackendToken
            }
            if let keychainToken = KeychainStore.string(forKey: Self.backendTokenDefaultsKey) {
                return keychainToken
            }
            #if DEBUG
            return UserDefaults.standard.string(forKey: Self.backendTokenFallbackDefaultsKey)
            #else
            return nil
            #endif
        }
        set {
            if !persistsData { cachedBackendToken = newValue; return }
            if let newValue, !newValue.isEmpty {
                if KeychainStore.set(newValue, forKey: Self.backendTokenDefaultsKey) {
                    cachedBackendToken = newValue
                    UserDefaults.standard.removeObject(forKey: Self.backendTokenFallbackDefaultsKey)
                } else {
                    #if DEBUG
                    cachedBackendToken = newValue
                    UserDefaults.standard.set(newValue, forKey: Self.backendTokenFallbackDefaultsKey)
                    #else
                    cachedBackendToken = nil
                    toastMessage = "安全存储异常，请重新登录"
                    #endif
                }
            } else {
                cachedBackendToken = nil
                KeychainStore.delete(forKey: Self.backendTokenDefaultsKey)
                UserDefaults.standard.removeObject(forKey: Self.backendTokenFallbackDefaultsKey)
            }
        }
    }

    // MARK: - Persistence Helpers

    private static func migrateBackendTokenToKeychain() {
        let defaults = UserDefaults.standard
        let legacyToken = defaults.string(forKey: backendTokenDefaultsKey) ?? defaults.string(forKey: backendTokenFallbackDefaultsKey)
        guard let legacyToken, !legacyToken.isEmpty else {
            defaults.removeObject(forKey: backendTokenFallbackDefaultsKey)
            return
        }
        if KeychainStore.string(forKey: backendTokenDefaultsKey) == nil {
            if KeychainStore.set(legacyToken, forKey: backendTokenDefaultsKey) {
                defaults.removeObject(forKey: backendTokenDefaultsKey)
                defaults.removeObject(forKey: backendTokenFallbackDefaultsKey)
            } else {
                defaults.removeObject(forKey: backendTokenDefaultsKey)
                #if DEBUG
                defaults.set(legacyToken, forKey: backendTokenFallbackDefaultsKey)
                #else
                defaults.removeObject(forKey: backendTokenFallbackDefaultsKey)
                #endif
            }
            return
        }
        defaults.removeObject(forKey: backendTokenDefaultsKey)
        defaults.removeObject(forKey: backendTokenFallbackDefaultsKey)
    }

    private static func restoreMessageLimitDefaultIfDisabledByTemporaryMigration() {
        let defaults = UserDefaults.standard
        guard defaults.bool(forKey: legacyMessageLimitDefaultDisabledMigrationKey),
              !defaults.bool(forKey: messageLimitDefaultRestoredMigrationKey)
        else { return }
        defaults.set(true, forKey: messageLimitDefaultsKey)
        defaults.set(true, forKey: messageLimitDefaultRestoredMigrationKey)
    }

    private static func browsingHistoryDefaultsKey(for userID: String) -> String {
        "\(browsingHistoryDefaultsKeyPrefix).\(userID)"
    }

    private static var blankUser: User {
        User(
            id: demoUserID,
            nickname: "未登录用户",
            bio: "点击这里，填写简介",
            followingCount: 0,
            followersCount: 0,
            postCount: 0,
            isRestricted: false,
            canShowContact: true,
            avatarSymbol: "周",
            avatarTint: .rose,
            redBookID: "",
            gender: "未设置",
            birthday: "选择生日",
            region: "未设置",
            backgroundImageName: "merch_magazine",
            phoneNumber: ""
        )
    }

    private static var messageThreadsStorageURL: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("zhoubiantuan-message-threads.json")
    }

    private static func resetLocalDataForEmptyBetaIfNeeded() {
        let defaults = UserDefaults.standard
        guard defaults.integer(forKey: localDataResetDefaultsKey) < currentLocalDataResetVersion else { return }

        defaults.removeObject(forKey: loginDefaultsKey)
        defaults.removeObject(forKey: backendTokenDefaultsKey)
        defaults.removeObject(forKey: backendTokenFallbackDefaultsKey)
        defaults.removeObject(forKey: searchHistoryDefaultsKey)
        defaults.removeObject(forKey: messageThreadsDefaultsKey)

        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(browsingHistoryDefaultsKeyPrefix) {
            defaults.removeObject(forKey: key)
        }

        KeychainStore.delete(forKey: backendTokenDefaultsKey)
        if let storageURL = messageThreadsStorageURL {
            try? FileManager.default.removeItem(at: storageURL)
        }

        defaults.set(false, forKey: loginDefaultsKey)
        defaults.set(currentLocalDataResetVersion, forKey: localDataResetDefaultsKey)
    }

    private func persistThreads() {
        guard persistsData, !isRestoringThreads,
              let data = try? JSONEncoder().encode(threads) else { return }
        guard let storageURL = Self.messageThreadsStorageURL else {
            UserDefaults.standard.set(data, forKey: Self.messageThreadsDefaultsKey)
            return
        }
        try? FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: storageURL, options: .atomic)
    }

    private func restorePersistedThreads() {
        let fileData = Self.messageThreadsStorageURL.flatMap { try? Data(contentsOf: $0) }
        guard let data = fileData ?? UserDefaults.standard.data(forKey: Self.messageThreadsDefaultsKey),
              let restoredThreads = try? JSONDecoder().decode([MessageThread].self, from: data) else { return }
        var seenThreadIDs = Set<String>()
        let dedupedThreads = restoredThreads.filter { seenThreadIDs.insert($0.id).inserted }
        isRestoringThreads = true
        threads = dedupedThreads
        isRestoringThreads = false
    }

    private static func normalizedMessageImageData(_ data: Data) -> Data {
        ImageDataNormalizer.jpegData(from: data, maxSide: 1600, compressionQuality: 0.78)
    }

    func isCurrentSession(_ session: UUID) -> Bool {
        session == authSessionVersion && !Task.isCancelled
    }

    func runSessionTask(_ operation: @escaping (UUID) async -> Void) {
        let session = authSessionVersion
        let taskID = UUID()
        sessionTasks[taskID] = Task { [weak self] in
            guard let self, self.isCurrentSession(session) else { return }
            defer { self.sessionTasks[taskID] = nil }
            await operation(session)
        }
    }

    private func invalidateSessionWork() {
        authSessionVersion = UUID()
        authenticationAttempt = UUID()
        sessionTasks.values.forEach { $0.cancel() }
        sessionTasks.removeAll()
        stopBackendAutoRefresh()
        refreshRequestID = nil
        syncRequestID = nil
        feedRequestID = nil
        isLoadingInitialFeed = false
    }

    // MARK: - Initialization

    init(backendClient: AliyunBackendClient = AliyunBackendClient(), persistsData: Bool = true, automaticallyRefresh: Bool = true) {
        self.backendClient = backendClient
        self.persistsData = persistsData
        self.automaticallyRefresh = automaticallyRefresh
        if persistsData {
            Self.resetLocalDataForEmptyBetaIfNeeded()
            Self.migrateBackendTokenToKeychain()
            Self.restoreMessageLimitDefaultIfDisabledByTemporaryMigration()
            cachedBackendToken = KeychainStore.string(forKey: Self.backendTokenDefaultsKey)
        }
        let startsLoggedIn = persistsData && (UserDefaults.standard.object(forKey: Self.loginDefaultsKey) as? Bool ?? false)
        isLoggedIn = startsLoggedIn
        isDarkModeEnabled = UserDefaults.standard.object(forKey: Self.darkModeDefaultsKey) as? Bool ?? true
        limitsUnrepliedMessages = UserDefaults.standard.object(forKey: Self.messageLimitDefaultsKey) as? Bool ?? true
        UserDefaults.standard.set(true, forKey: Self.backendEnabledDefaultsKey)
        isBackendEnabled = true
        let blankUser = Self.blankUser
        users = [blankUser]
        currentUserID = blankUser.id
        posts = []
        collections = []
        reviews = []
        comments = []
        threads = []
        moderationReviews = []
        reports = []
        reminders = []
        likedPostIDs = []
        favoritePostIDs = []
        followedUserIDs = []
        followingIDsByUserID = [blankUser.id: []]
        browsingHistoryIDs = UserDefaults.standard.stringArray(forKey: Self.browsingHistoryDefaultsKey(for: blankUser.id)) ?? []
        searchHistory = UserDefaults.standard.stringArray(forKey: Self.searchHistoryDefaultsKey) ?? []
        if persistsData { restorePersistedThreads() }
        if isBackendEnabled, backendToken == nil {
            invalidateCloudSessionForMissingToken(prompt: false)
        }
    }

    // MARK: - Session and Backend Sync

    var currentUser: User {
        users.first(where: { $0.id == currentUserID }) ?? users.first ?? Self.blankUser
    }

    func loadBackendIfNeeded() async {
        guard isBackendEnabled else { return }
        await refreshFromBackend(silent: true)
    }

    func loadPublicFeedIfNeeded() async {
        let session = authSessionVersion
        guard isBackendEnabled, posts.isEmpty, !isLoadingInitialFeed else { return }
        let requestID = UUID()
        feedRequestID = requestID
        isLoadingInitialFeed = true
        defer { if feedRequestID == requestID { feedRequestID = nil; isLoadingInitialFeed = false } }
        do {
            let payload = try await backendClient.feed(limit: 40)
            guard isCurrentSession(session) else { return }
            applyPublicFeedPayload(payload)
        } catch {
            guard isCurrentSession(session) else { return }
            // The full authenticated bootstrap still runs after this best-effort first-screen request.
        }
    }

    func startBackendAutoRefresh() {
        guard automaticallyRefresh, isBackendEnabled, let backendToken else { return }
        startRealtimeConnection(token: backendToken)
        guard backendRefreshTask == nil else { return }
        backendRefreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: Self.backendFallbackRefreshIntervalNanoseconds)
                guard !Task.isCancelled else { break }
                await self?.runFallbackSyncIfNeeded()
            }
        }
    }

    func stopBackendAutoRefresh() {
        backendRefreshTask?.cancel()
        backendRefreshTask = nil
        realtimeConnection?.disconnect()
        realtimeConnection = nil
        isRealtimeConnected = false
    }

    func backendModeChanged() {
        invalidateSessionWork()
        if isBackendEnabled {
            if backendToken == nil {
                logOut()
                showToast("已切换到阿里云后端，请登录测试账号")
            } else {
                runSessionTask { [self] session in
                    guard isCurrentSession(session) else { return }
                    await refreshFromBackend()
                }
                startBackendAutoRefresh()
            }
        } else {
            stopBackendAutoRefresh()
            backendToken = nil
            showToast("已切换到本地 Mock 数据")
        }
    }

    func refreshFromBackend(silent: Bool = false) async {
        let session = authSessionVersion
        guard isBackendEnabled, let backendToken else { return }
        guard !isRefreshingFromBackend else { return }
        let requestID = UUID()
        refreshRequestID = requestID
        defer { if refreshRequestID == requestID { refreshRequestID = nil } }
        do {
            let payload = try await backendClient.bootstrap(token: backendToken)
            guard isCurrentSession(session) else { return }
            applyBackendPayload(payload)
            let appliedSession = authSessionVersion
            await loadBlockedUsers()
            guard isCurrentSession(appliedSession) else { return }
            if !silent {
                showToast("云端数据已同步")
            }
        } catch {
            guard isCurrentSession(session) else { return }
            if isAuthExpiredError(error) {
                expireCloudSession(silent: silent)
                return
            }
            if !silent {
                showToast(error.localizedDescription)
            }
        }
    }

    func syncFromBackend(reason: String = "manual") async {
        let session = authSessionVersion
        guard isBackendEnabled, let backendToken else { return }
        guard !isRefreshingFromBackend, !isSyncingFromBackend else { return }
        guard let cursor = SyncCursorStore.cursor(for: currentUserID) else {
            await refreshFromBackend(silent: true)
            guard isCurrentSession(session) else { return }
            return
        }
        let requestID = UUID()
        syncRequestID = requestID
        defer { if syncRequestID == requestID { syncRequestID = nil } }
        do {
            let payload = try await backendClient.sync(token: backendToken, cursor: cursor)
            guard isCurrentSession(session) else { return }
            if payload.resetRequired == true {
                await refreshFromBackend(silent: true)
                guard isCurrentSession(session) else { return }
                return
            }
            applySyncPayload(payload)
            if payload.contentRefreshRequired == true {
                await refreshFromBackend(silent: true)
                guard isCurrentSession(session) else { return }
                return
            }
            if payload.hasMore {
                runSessionTask { [self] session in
                    guard isCurrentSession(session) else { return }
                    await syncFromBackend(reason: "\(reason).more")
                }
            }
        } catch {
            guard isCurrentSession(session) else { return }
            if isAuthExpiredError(error) {
                expireCloudSession(silent: true)
                return
            }
            if reason == "foreground" || reason == "manual" {
                await refreshFromBackend(silent: true)
                guard isCurrentSession(session) else { return }
            }
        }
    }

    private func startRealtimeConnection(token: String) {
        let session = authSessionVersion
        if realtimeConnection == nil {
            realtimeConnection = RealtimeConnection(
                backendClient: backendClient,
                onEvent: { [weak self] event in
                    guard let self, self.isCurrentSession(session) else { return }
                    await self.handleRealtimeEvent(event)
                },
                onStateChange: { [weak self] connected in
                    guard let self, self.isCurrentSession(session) else { return }
                    self.handleRealtimeStateChange(connected)
                }
            )
        }
        realtimeConnection?.connect(token: token)
    }

    private func handleRealtimeStateChange(_ connected: Bool) {
        isRealtimeConnected = connected
        lastRealtimeActivityAt = Date()
        if connected {
            runSessionTask { [self] session in
                try? await Task.sleep(nanoseconds: 250_000_000)
                guard isCurrentSession(session) else { return }
                await syncFromBackend(reason: "websocket.connected")
                guard isCurrentSession(session) else { return }
            }
        }
    }

    private func handleRealtimeEvent(_ event: BackendRealtimeEvent) async {
        guard event.type == "sync.available" else { return }
        lastRealtimeActivityAt = Date()
        await syncFromBackend(reason: "websocket.\(event.eventType ?? "event")")
    }

    private func runFallbackSyncIfNeeded() async {
        guard isBackendEnabled, backendToken != nil else { return }
        guard Date().timeIntervalSince(lastRealtimeActivityAt) >= Self.backendFallbackGraceInterval else { return }
        await syncFromBackend(reason: "fallback")
    }

    private func isAuthExpiredError(_ error: Error) -> Bool {
        let nsError = error as NSError
        return nsError.domain == "AliyunBackendClient" && nsError.code == 401
    }

    private func expireCloudSession(silent: Bool = false) {
        logOut()
        isAuthPromptPresented = !silent
        toastMessage = silent ? nil : "登录已失效，请重新登录"
    }

    private func invalidateCloudSessionForMissingToken(prompt: Bool, toast: String? = nil) {
        logOut()
        isAuthPromptPresented = prompt
        toastMessage = toast
    }

    private func applyBackendPayload(_ payload: BackendPayload) {
        let previousUserID = currentUserID
        let previousLoggedIn = isLoggedIn
        if payload.token != nil || (payload.currentUser?.id != nil && payload.currentUser?.id != previousUserID) || (!previousLoggedIn && payload.currentUser != nil) {
            invalidateSessionWork()
        }
        if let token = payload.token {
            backendToken = token
        }
        if let users = payload.users {
            self.users = users.map { $0.localUser() }
        }
        if let posts = payload.posts {
            self.posts = posts.map { $0.localPost() }
        }
        if let collections = payload.collections {
            self.collections = collections.map { $0.localCollection() }
        }
        if let comments = payload.comments {
            self.comments = comments.map { $0.localComment() }
        }
        if let messageThreads = payload.messageThreads {
            self.threads = mergedMessageThreads(from: messageThreads.map { $0.localThread() })
        }
        if let reports = payload.reports {
            self.reports = reports.map { $0.localReport() }
        }
        if let likedPostIDs = payload.likedPostIDs {
            self.likedPostIDs = Set(likedPostIDs)
        }
        if let favoritePostIDs = payload.favoritePostIDs {
            self.favoritePostIDs = Set(favoritePostIDs)
        }
        if let followedUserIDs = payload.followedUserIDs {
            self.followedUserIDs = Set(followedUserIDs)
        }
        if let followingByUserID = payload.followingByUserID {
            self.followingIDsByUserID = followingByUserID.mapValues { Set($0) }
        }
        if let blockedUserIDs = payload.blockedUserIDs {
            self.blockedUserIDs = Set(blockedUserIDs)
        }
        if let blockedByUserIDs = payload.blockedByUserIDs {
            self.blockedByUserIDs = Set(blockedByUserIDs)
        }
        if let currentUser = payload.currentUser?.localUser() {
            if !users.contains(where: { $0.id == currentUser.id }) {
                users.append(currentUser)
            }
            currentUserID = currentUser.id
            browsingHistoryIDs = UserDefaults.standard.stringArray(forKey: Self.browsingHistoryDefaultsKey(for: currentUser.id)) ?? []
        }
        followingIDsByUserID[currentUserID] = followedUserIDs
        isLoggedIn = payload.currentUser != nil
        isAuthPromptPresented = false
        if let syncCursor = payload.syncCursor {
            SyncCursorStore.set(syncCursor, for: currentUserID)
        }
        if automaticallyRefresh, isBackendEnabled, backendToken != nil, isLoggedIn {
            startBackendAutoRefresh()
            runSessionTask { [self] session in
                try? await Task.sleep(nanoseconds: 500_000_000)
                guard isCurrentSession(session) else { return }
                await syncFromBackend(reason: "bootstrap.cursor")
                guard isCurrentSession(session) else { return }
            }
        }
    }

    private func applyPublicFeedPayload(_ payload: BackendPayload) {
        mergeUsers(payload.users?.map { $0.localUser() } ?? [])
        mergePosts(payload.posts?.map { $0.localPost() } ?? [])
        mergeCollections(payload.collections?.map { $0.localCollection() } ?? [])
    }

    private func mergedMessageThreads(from backendThreads: [MessageThread]) -> [MessageThread] {
        let recentCutoff = Date().addingTimeInterval(-120)
        var merged = Dictionary(uniqueKeysWithValues: backendThreads.map { ($0.id, $0) })
        for localThread in threads where isCurrentUserThread(localThread) {
            if var backendThread = merged[localThread.id] {
                backendThread = preservingLocalMessageState(backendThread: backendThread, localThread: localThread)
                let backendMessageIDs = Set(backendThread.messages.map(\.id))
                let localOnlyMessages = localThread.messages.filter {
                    !backendMessageIDs.contains($0.id) && ($0.createdAt > recentCutoff || $0.deliveryStatus.isFailed)
                }
                if !localOnlyMessages.isEmpty {
                    backendThread.messages.append(contentsOf: localOnlyMessages)
                    backendThread.messages.sort { $0.createdAt < $1.createdAt }
                    backendThread.updatedAt = max(backendThread.updatedAt, localThread.updatedAt)
                    merged[localThread.id] = backendThread
                }
                continue
            }
            let hasRecentDraft = localThread.updatedAt > recentCutoff
                || localThread.messages.contains { $0.createdAt > recentCutoff || $0.deliveryStatus.isFailed }
            if hasRecentDraft {
                merged[localThread.id] = localThread
            }
        }
        return deduplicatedMessageThreads(Array(merged.values)).sorted { $0.updatedAt > $1.updatedAt }
    }

    private func applySyncPayload(_ payload: BackendSyncPayload) {
        let removedUsers = Set(payload.removedUserIDs ?? [])
        let removedCollections = Set(payload.removedCollectionIDs ?? []).union(collections.filter { removedUsers.contains($0.ownerID) }.map(\.id))
        let removedPosts = Set(payload.removedPostIDs ?? []).union(posts.filter {
            removedUsers.contains($0.authorID) || ($0.collectionID.map { removedCollections.contains($0) } ?? false)
        }.map(\.id))
        let removedComments = Set(payload.removedCommentIDs ?? [])
        users.removeAll { removedUsers.contains($0.id) }
        collections.removeAll { removedCollections.contains($0.id) }
        posts.removeAll { removedPosts.contains($0.id) }
        comments.removeAll { removedComments.contains($0.id) || removedPosts.contains($0.postID) || removedUsers.contains($0.authorID) }
        if !removedUsers.isEmpty {
            threads = threads.map { thread in
                var updated = thread
                updated.messages = thread.messages.map { message in
                    guard removedUsers.contains(message.senderID) else { return message }
                    var revoked = message
                    revoked.isRevoked = true
                    revoked.body = ""
                    revoked.imageData = nil
                    revoked.remoteImageURL = ""
                    return revoked
                }
                return updated
            }
        }
        likedPostIDs.subtract(removedPosts)
        favoritePostIDs.subtract(removedPosts)
        followedUserIDs.subtract(removedUsers)
        mergeUsers(payload.users?.map { $0.localUser() } ?? [])
        mergePosts(payload.posts?.map { $0.localPost() } ?? [])
        mergeCollections(payload.collections?.map { $0.localCollection() } ?? [])
        mergeComments(payload.comments?.map { $0.localComment() } ?? [])
        mergeChangedMessageThreads(from: payload.messageThreads.map { $0.localThread() })
        if let likedPostIDs = payload.likedPostIDs {
            self.likedPostIDs = Set(likedPostIDs)
        }
        if let favoritePostIDs = payload.favoritePostIDs {
            self.favoritePostIDs = Set(favoritePostIDs)
        }
        if let followedUserIDs = payload.followedUserIDs {
            self.followedUserIDs = Set(followedUserIDs)
        }
        if let followingByUserID = payload.followingByUserID {
            self.followingIDsByUserID = followingByUserID.mapValues { Set($0) }
        }
        if let blockedUserIDs = payload.blockedUserIDs {
            self.blockedUserIDs = Set(blockedUserIDs)
        }
        if let blockedByUserIDs = payload.blockedByUserIDs {
            self.blockedByUserIDs = Set(blockedByUserIDs)
        }
        followingIDsByUserID[currentUserID] = followedUserIDs
        SyncCursorStore.set(payload.nextCursor, for: currentUserID)
    }

    private func mergeUsers(_ backendUsers: [User]) {
        guard !backendUsers.isEmpty else { return }
        var usersByID = Dictionary(uniqueKeysWithValues: users.map { ($0.id, $0) })
        var order = users.map(\.id)
        for user in backendUsers {
            if usersByID[user.id] == nil {
                order.append(user.id)
            }
            usersByID[user.id] = user
        }
        users = order.compactMap { usersByID[$0] }
    }

    private func mergePosts(_ backendPosts: [GroupBuyPost]) {
        guard !backendPosts.isEmpty else { return }
        var postsByID = Dictionary(uniqueKeysWithValues: posts.map { ($0.id, $0) })
        var order = posts.map(\.id)
        for post in backendPosts {
            if postsByID[post.id] == nil {
                guard post.status != .deleted else { continue }
                order.insert(post.id, at: 0)
            }
            postsByID[post.id] = post
        }
        posts = order.compactMap { postsByID[$0] }
    }

    private func mergeCollections(_ backendCollections: [GroupCollection]) {
        guard !backendCollections.isEmpty else { return }
        var collectionsByID = Dictionary(uniqueKeysWithValues: collections.map { ($0.id, $0) })
        var order = collections.map(\.id)
        for collection in backendCollections {
            if collectionsByID[collection.id] == nil {
                guard collection.status != .deleted else { continue }
                order.append(collection.id)
            }
            collectionsByID[collection.id] = collection
        }
        collections = order.compactMap { collectionsByID[$0] }
    }

    private func mergeComments(_ backendComments: [Comment]) {
        guard !backendComments.isEmpty else { return }
        var commentsByID = Dictionary(uniqueKeysWithValues: comments.map { ($0.id, $0) })
        var order = comments.map(\.id)
        for comment in backendComments {
            if commentsByID[comment.id] == nil {
                order.append(comment.id)
            }
            commentsByID[comment.id] = comment
        }
        comments = order.compactMap { commentsByID[$0] }
    }

    private func mergeChangedMessageThreads(from backendThreads: [MessageThread]) {
        guard !backendThreads.isEmpty else { return }
        let recentCutoff = Date().addingTimeInterval(-120)
        var merged = Dictionary(threads.map { ($0.id, $0) }, uniquingKeysWith: { _, newer in newer })
        for var backendThread in backendThreads {
            if let localThread = merged[backendThread.id] {
                backendThread = preservingLocalMessageState(backendThread: backendThread, localThread: localThread)
                let backendMessageIDs = Set(backendThread.messages.map(\.id))
                let localOnlyMessages = localThread.messages.filter {
                    !backendMessageIDs.contains($0.id) && ($0.createdAt > recentCutoff || $0.deliveryStatus.isFailed)
                }
                if !localOnlyMessages.isEmpty {
                    backendThread.messages.append(contentsOf: localOnlyMessages)
                    backendThread.messages.sort { $0.createdAt < $1.createdAt }
                }
                backendThread.updatedAt = max(backendThread.updatedAt, localThread.updatedAt)
            }
            merged[backendThread.id] = backendThread
        }
        threads = Array(merged.values).sorted { $0.updatedAt > $1.updatedAt }
    }

    private func preservingLocalMessageState(backendThread: MessageThread, localThread: MessageThread) -> MessageThread {
        var thread = backendThread
        let localMessages = Dictionary(uniqueKeysWithValues: localThread.messages.map { ($0.id, $0) })
        thread.messages = thread.messages.map { backendMessage in
            guard let localMessage = localMessages[backendMessage.id] else { return backendMessage }
            var message = backendMessage
            if message.imageData == nil {
                message.imageData = localMessage.imageData
            }
            if message.imageObjectKey.isEmpty {
                message.imageObjectKey = localMessage.imageObjectKey
            }
            return message
        }
        return thread
    }

    private func runBackendMutation(refreshAfterSuccess: Bool = false, syncAfterSuccess: Bool = false, refreshAfterFailure: Bool = false, _ operation: @escaping (String, UUID) async throws -> Void) {
        guard isBackendEnabled, let backendToken else { return }
        runSessionTask { [self] session in
            do {
                try await operation(backendToken, session)
                guard isCurrentSession(session) else { return }
                if refreshAfterSuccess {
                    await refreshFromBackend(silent: true)
                    guard isCurrentSession(session) else { return }
                } else if syncAfterSuccess {
                    await syncFromBackend(reason: "mutation")
                    guard isCurrentSession(session) else { return }
                }
            } catch {
                guard isCurrentSession(session) else { return }
                showToast(error.localizedDescription)
                if refreshAfterFailure {
                    await refreshFromBackend(silent: true)
                    guard isCurrentSession(session) else { return }
                }
            }
        }
    }

    // MARK: - Queries

    var activePosts: [GroupBuyPost] {
        posts.filter { $0.status == .active && post(id: $0.id) != nil }
    }

    func profilePosts(userID: String) -> [GroupBuyPost] {
        guard canShowContent(from: userID) else { return [] }
        let source = activePosts.filter { $0.authorID == userID }
        return sortedFeedPosts(source)
    }

    func profileAttentionPosts(userID: String) -> [GroupBuyPost] {
        guard userID == currentUserID else { return [] }
        let source = posts.filter { $0.authorID == userID && $0.status.needsOwnerAttention }
        return sortedFeedPosts(source)
    }

    var messageThreads: [MessageThread] {
        deduplicatedMessageThreads(threads.filter(isCurrentUserThread))
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    var unreadMessageCount: Int {
        messageThreads.reduce(0) { total, thread in
            total + max(thread.unreadCount, 0)
        }
    }

    var currentUserReminders: [Reminder] {
        reminders
            .filter { $0.userID == currentUserID }
            .sorted { $0.deadline < $1.deadline }
    }

    func messageThread(id: String) -> MessageThread? {
        messageThreads.first { $0.id == id } ?? threads.first { $0.id == id && isCurrentUserThread($0) }
    }

    private func deduplicatedMessageThreads(_ source: [MessageThread]) -> [MessageThread] {
        var byPeer: [String: MessageThread] = [:]
        let ordered = source.sorted { $0.updatedAt > $1.updatedAt }
        for thread in ordered {
            let peerID = peerUserID(for: thread)
            guard var existing = byPeer[peerID] else {
                byPeer[peerID] = thread
                continue
            }
            let existingIDs = Set(existing.messages.map(\.id))
            let newMessages = thread.messages.filter { !existingIDs.contains($0.id) }
            existing.messages.append(contentsOf: newMessages)
            existing.messages.sort { $0.createdAt < $1.createdAt }
            existing.updatedAt = max(existing.updatedAt, thread.updatedAt)
            existing.unreadCount += max(thread.unreadCount, 0)
            if existing.relatedPostID == nil {
                existing.relatedPostID = thread.relatedPostID
            }
            byPeer[peerID] = existing
        }
        return Array(byPeer.values)
    }

    func isCurrentUserThread(_ thread: MessageThread) -> Bool {
        thread.buyerUserID == currentUserID || thread.publisherUserID == currentUserID
    }

    func peerUserID(for thread: MessageThread) -> String {
        thread.publisherUserID == currentUserID ? thread.buyerUserID : thread.publisherUserID
    }

    func user(id: String) -> User {
        users.first(where: { $0.id == id }) ?? User(id: id, nickname: "用户资料暂不可用", bio: "", followingCount: 0,
            followersCount: 0, postCount: 0, isRestricted: false, canShowContact: false, avatarSymbol: "?", avatarTint: .rose)
    }

    func post(id: String) -> GroupBuyPost? {
        guard let post = posts.first(where: { $0.id == id }),
              post.status != .deleted,
              post.status == .active || post.authorID == currentUserID,
              canShowContent(from: post.authorID) else { return nil }
        if let collectionID = post.collectionID, let collection = collections.first(where: { $0.id == collectionID }),
           collection.status != .active && collection.ownerID != currentUserID { return nil }
        return post
    }

    func isPostHiddenByBlock(id: String) -> Bool {
        guard let post = posts.first(where: { $0.id == id }) else { return false }
        return post.status == .active && !canShowContent(from: post.authorID)
    }

    func collection(id: String?) -> GroupCollection? {
        guard let id else { return nil }
        return collections.first(where: { $0.id == id })
    }

    func registrationID(for userID: String) -> String {
        let registrationNumber = (users.firstIndex { $0.id == userID } ?? 0) + 1
        return String(format: "%06d", registrationNumber)
    }

    func followingUsers(for userID: String) -> [User] {
        let ids = followingIDs(for: userID)
        return users
            .filter { ids.contains($0.id) }
            .sorted { registrationID(for: $0.id) < registrationID(for: $1.id) }
    }

    func followerUsers(for userID: String) -> [User] {
        users
            .filter { followingIDs(for: $0.id).contains(userID) }
            .sorted { registrationID(for: $0.id) < registrationID(for: $1.id) }
    }

    func mutualFriendUsers() -> [User] {
        users
            .filter { user in
                user.id != currentUserID &&
                followedUserIDs.contains(user.id) &&
                followingIDs(for: user.id).contains(currentUserID)
            }
            .sorted { registrationID(for: $0.id) < registrationID(for: $1.id) }
    }

    func relationUsers(for userID: String, kind: UserRelationKind) -> [User] {
        let users = switch kind {
        case .following: followingUsers(for: userID)
        case .followers: followerUsers(for: userID)
        }
        return users.filter { canShowContent(from: $0.id) }
    }

    private func followingIDs(for userID: String) -> Set<String> {
        userID == currentUserID ? followedUserIDs : (followingIDsByUserID[userID] ?? [])
    }

    func collections(ownerID: String) -> [GroupCollection] {
        guard canShowContent(from: ownerID) else { return [] }
        return collections
            .filter { $0.ownerID == ownerID }
            .sorted { lhs, rhs in
                if lhs.isEnded != rhs.isEnded {
                    return !lhs.isEnded
                }
                return lhs.createdAt > rhs.createdAt
            }
    }

    func unfinishedCollectionCount(ownerID: String) -> Int {
        collections.filter { $0.ownerID == ownerID && !$0.isEnded }.count
    }

    func completedGroupTotal(for userID: String) -> Int {
        user(id: userID).postCount
    }

    func posts(in collectionID: String) -> [GroupBuyPost] {
        guard let collection = collection(id: collectionID) else { return [] }
        return sortedFeedPosts(collection.postIDs.compactMap(post).filter { $0.status == .active })
    }

    func sortedFeedPosts(_ posts: [GroupBuyPost]) -> [GroupBuyPost] {
        posts.sorted { lhs, rhs in
            if lhs.isEnded != rhs.isEnded {
                return !lhs.isEnded
            }
            return lhs.createdAt > rhs.createdAt
        }
    }

    func splitGoodsPosts(matchingRole keyword: String) -> [GroupBuyPost] {
        let trimmed = keyword.trimmed
        guard !trimmed.isEmpty else { return [] }
        return activePosts
            .filter { post in
                post.groupType == .splitGoods &&
                post.unsoldRoles.contains { role in
                    role.isAvailable && SearchMatcher.matches(query: trimmed, candidate: role.name)
                }
            }
            .sorted { lhs, rhs in
                let lhsScore = lhs.unsoldRoles.map { SearchMatcher.score(query: trimmed, candidate: $0.name) }.max() ?? 0
                let rhsScore = rhs.unsoldRoles.map { SearchMatcher.score(query: trimmed, candidate: $0.name) }.max() ?? 0
                if lhsScore != rhsScore { return lhsScore > rhsScore }
                return lhs.createdAt > rhs.createdAt
            }
    }

    func groupLeaderUsers(matching keyword: String) -> [User] {
        let trimmed = keyword.trimmed
        let userMatches = users.filter { user in
            guard user.id != currentUserID else { return false }
            guard canShowContent(from: user.id) else { return false }
            guard !trimmed.isEmpty else { return false }
            let authoredText = posts
                .filter { $0.authorID == user.id && $0.status == .active }
                .flatMap { post in
                    [post.title, post.description, post.price] + post.categoryTags + post.fandomTags + post.unsoldRoles.map(\.name)
                }
                .joined(separator: " ")
            let searchableText = [
                user.nickname,
                user.redBookID,
                user.bio,
                user.region,
                user.email,
                authoredText
            ]
                .joined(separator: " ")
            return SearchMatcher.matches(query: trimmed, candidate: searchableText)
        }

        return userMatches.sorted { lhs, rhs in
            let lhsScore = SearchMatcher.score(query: trimmed, candidate: [lhs.nickname, lhs.redBookID, lhs.bio, lhs.region].joined(separator: " "))
            let rhsScore = SearchMatcher.score(query: trimmed, candidate: [rhs.nickname, rhs.redBookID, rhs.bio, rhs.region].joined(separator: " "))
            if lhsScore != rhsScore { return lhsScore > rhsScore }
            if followedUserIDs.contains(lhs.id) != followedUserIDs.contains(rhs.id) {
                return followedUserIDs.contains(lhs.id)
            }
            return lhs.followersCount > rhs.followersCount
        }
    }

    func availableRoles(for postID: String) -> [UnsoldRole] {
        post(id: postID)?.unsoldRoles.filter(\.isAvailable).sorted { $0.name < $1.name } ?? []
    }

    func browsingHistoryPosts() -> [GroupBuyPost] {
        browsingHistoryIDs.compactMap(post).filter { $0.status == .active }
    }

    // MARK: - History and Search

    func recordBrowse(postID: String) {
        browsingHistoryIDs.removeAll { $0 == postID }
        browsingHistoryIDs.insert(postID, at: 0)
        if browsingHistoryIDs.count > 30 {
            browsingHistoryIDs = Array(browsingHistoryIDs.prefix(30))
        }
    }

    func recordSearchHistory(_ term: String) {
        let trimmed = term.trimmed
        guard !trimmed.isEmpty else { return }
        searchHistory.removeAll { $0.localizedCaseInsensitiveCompare(trimmed) == .orderedSame }
        searchHistory.insert(trimmed, at: 0)
        if searchHistory.count > 20 {
            searchHistory = Array(searchHistory.prefix(20))
        }
    }

    func removeBrowsingHistory(postIDs: Set<String>) {
        browsingHistoryIDs.removeAll { postIDs.contains($0) }
        showToast(postIDs.isEmpty ? "未选择记录" : "已删除浏览记录")
    }

    func comments(for postID: String) -> [Comment] {
        comments
            .filter { comment in
                comment.postID == postID &&
                canShowContent(from: comment.authorID) &&
                (comment.status == .active || (comment.authorID == currentUserID && comment.status != .deleted))
            }
            .sorted { $0.createdAt < $1.createdAt }
    }

    func comment(id: String) -> Comment? {
        comments.first(where: { $0.id == id })
    }

    func canDeleteComment(_ comment: Comment) -> Bool {
        comment.authorID == currentUserID || post(id: comment.postID)?.authorID == currentUserID
    }

    @discardableResult
    // MARK: - Auth Gate

    func requireLogin(prompt: String = "登录后才能使用该功能") -> Bool {
        guard isLoggedIn else {
            showToast(prompt)
            isAuthPromptPresented = true
            return false
        }
        return true
    }

    // MARK: - Reactions and Social

    func toggleLike(postID: String) {
        guard requireLogin(prompt: "登录后才能点赞") else { return }
        guard let index = posts.firstIndex(where: { $0.id == postID }) else { return }
        if likedPostIDs.contains(postID) {
            likedPostIDs.remove(postID)
            posts[index].likedCount = max(0, posts[index].likedCount - 1)
            runBackendMutation(syncAfterSuccess: true) { [self] token, session in
                try await self.backendClient.setPostFlag(token: token, postID: postID, flag: "like", enabled: false)
                guard isCurrentSession(session) else { return }
            }
        } else {
            likedPostIDs.insert(postID)
            posts[index].likedCount += 1
            runBackendMutation(syncAfterSuccess: true) { [self] token, session in
                try await self.backendClient.setPostFlag(token: token, postID: postID, flag: "like", enabled: true)
                guard isCurrentSession(session) else { return }
            }
        }
    }

    func toggleFavorite(postID: String) {
        guard requireLogin(prompt: "登录后才能收藏") else { return }
        guard let index = posts.firstIndex(where: { $0.id == postID }) else { return }
        if favoritePostIDs.contains(postID) {
            favoritePostIDs.remove(postID)
            posts[index].favoriteCount = max(0, posts[index].favoriteCount - 1)
            reminders.removeAll { $0.postID == postID && $0.userID == currentUserID }
            showToast("已取消收藏和截团提醒")
            runBackendMutation(syncAfterSuccess: true) { [self] token, session in
                try await self.backendClient.setPostFlag(token: token, postID: postID, flag: "favorite", enabled: false)
                guard isCurrentSession(session) else { return }
            }
        } else {
            favoritePostIDs.insert(postID)
            posts[index].favoriteCount += 1
            let post = posts[index]
            reminders.append(Reminder(id: "re-\(postID)-\(Int(Date().timeIntervalSince1970))", userID: currentUserID, postID: postID, deadline: post.deadline, remindAt: post.deadline.addingTimeInterval(-3600 * 3), hasReminded: false))
            showToast("已收藏，截团前会提醒你")
            runBackendMutation(syncAfterSuccess: true) { [self] token, session in
                try await self.backendClient.setPostFlag(token: token, postID: postID, flag: "favorite", enabled: true)
                guard isCurrentSession(session) else { return }
            }
        }
    }

    func toggleFollow(userID: String) {
        guard requireLogin(prompt: "登录后才能关注") else { return }
        guard userID != currentUserID else { return }
        let targetIndex = users.firstIndex(where: { $0.id == userID })
        let currentIndex = users.firstIndex(where: { $0.id == currentUserID })
        if followedUserIDs.contains(userID) {
            followedUserIDs.remove(userID)
            followingIDsByUserID[currentUserID] = followedUserIDs
            if let currentIndex {
                users[currentIndex].followingCount = followedUserIDs.count
            }
            if let targetIndex {
                users[targetIndex].followersCount = max(0, users[targetIndex].followersCount - 1)
            }
            showToast("已取消关注")
            runBackendMutation(syncAfterSuccess: true) { [self] token, session in
                try await self.backendClient.setFollow(token: token, userID: userID, enabled: false)
                guard isCurrentSession(session) else { return }
            }
        } else {
            if blockedByUserIDs.contains(userID) {
                showToast("你已被对方拉黑，无法关注")
                return
            }
            if blockedUserIDs.contains(userID) {
                showToast("你已拉黑对方，解除拉黑后才能关注")
                return
            }
            followedUserIDs.insert(userID)
            followingIDsByUserID[currentUserID] = followedUserIDs
            if let currentIndex {
                users[currentIndex].followingCount = followedUserIDs.count
            }
            if let targetIndex {
                users[targetIndex].followersCount += 1
            }
            showToast("已关注团长")
            runBackendMutation(syncAfterSuccess: true) { [self] token, session in
                do {
                    try await self.backendClient.setFollow(token: token, userID: userID, enabled: true)
                    guard isCurrentSession(session) else { return }
                } catch {
                    guard isCurrentSession(session) else { return }
                    await MainActor.run {
                        guard self.isCurrentSession(session) else { return }
                        if let failureMessage = self.followBlockedFailureMessage(error, userID: userID) {
                            self.revertLocalFollow(userID: userID)
                            self.showToast(failureMessage)
                        } else {
                            self.showToast(error.localizedDescription)
                        }
                    }
                }
            }
        }
    }

    private func followBlockedFailureMessage(_ error: Error, userID: String) -> String? {
        let nsError = error as NSError
        guard nsError.domain == "AliyunBackendClient" else { return nil }
        switch nsError.userInfo[AliyunBackendClient.errorCodeUserInfoKey] as? String {
        case "blocked_by_recipient":
            blockedByUserIDs.insert(userID)
            return "你已被对方拉黑，无法关注"
        case "blocked_recipient":
            blockedUserIDs.insert(userID)
            return "你已拉黑对方，解除拉黑后才能关注"
        default:
            return nil
        }
    }

    private func revertLocalFollow(userID: String) {
        guard followedUserIDs.contains(userID) else { return }
        followedUserIDs.remove(userID)
        followingIDsByUserID[currentUserID] = followedUserIDs
        if let currentIndex = users.firstIndex(where: { $0.id == currentUserID }) {
            users[currentIndex].followingCount = followedUserIDs.count
        }
        if let targetIndex = users.firstIndex(where: { $0.id == userID }) {
            users[targetIndex].followersCount = max(0, users[targetIndex].followersCount - 1)
        }
    }

    // MARK: - Comments and Reports

    func addComment(postID: String, body: String, replyToID: String? = nil) {
        guard requireLogin(prompt: "登录后才能评论") else { return }
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if isBackendEnabled {
            runSessionTask { [self] session in
                guard let backendToken else { return }
                do {
                    let response = try await backendClient.addComment(token: backendToken, postID: postID, body: trimmed, replyToID: replyToID)
                    guard isCurrentSession(session) else { return }
                    let localComment = response.comment.localComment()
                    let alreadyHadComment = comments.contains { $0.id == localComment.id }
                    mergeComments([localComment])
                    if !alreadyHadComment, localComment.status == .active, let index = posts.firstIndex(where: { $0.id == postID }) {
                        posts[index].commentCount += 1
                    }
                    await syncFromBackend(reason: "comment.created")
                    guard isCurrentSession(session) else { return }
                    showToast(response.moderation?.userMessage ?? "评论已发布")
                } catch {
                    guard isCurrentSession(session) else { return }
                    showToast(error.localizedDescription)
                }
            }
            return
        }
        comments.append(Comment(id: "c-\(UUID().uuidString)", body: trimmed, authorID: currentUserID, postID: postID, replyToID: replyToID, createdAt: Date(), status: .active))
        if let index = posts.firstIndex(where: { $0.id == postID }) {
            posts[index].commentCount += 1
        }
        showToast("评论已发布")
    }

    func copyComment(_ comment: Comment) {
        UIPasteboard.general.string = comment.body
        showToast("已复制评论")
    }

    func deleteComment(commentID: String) {
        guard requireLogin(prompt: "登录后才能删除评论") else { return }
        guard let commentIndex = comments.firstIndex(where: { $0.id == commentID }),
              comments[commentIndex].status == .active else { return }
        let comment = comments[commentIndex]
        guard canDeleteComment(comment) else {
            showToast("只能删除自己的评论")
            return
        }
        comments[commentIndex].status = .deleted
        if let postIndex = posts.firstIndex(where: { $0.id == comment.postID }) {
            posts[postIndex].commentCount = max(0, posts[postIndex].commentCount - 1)
        }
        showToast("评论已删除")
        runBackendMutation(syncAfterSuccess: true) { [self] token, session in
            try await self.backendClient.deleteComment(token: token, commentID: commentID)
            guard isCurrentSession(session) else { return }
        }
    }

    func reportPost(postID: String, reason: String = "用户举报") {
        guard requireLogin(prompt: "登录后才能举报") else { return }
        reports.append(Report(id: "rp-\(UUID().uuidString)", target: .post(postID), reason: reason, detail: "来自详情页的原型举报。", reporterID: currentUserID, status: .pending, adminResult: nil, handledAt: nil))
        if let index = posts.firstIndex(where: { $0.id == postID }) {
            posts[index].reportCount += 1
        }
        showToast("已提交举报，管理员将后审处理")
        runBackendMutation { [self] token, session in
            try await self.backendClient.reportPost(token: token, postID: postID, reason: reason)
            guard isCurrentSession(session) else { return }
        }
    }

    func handleReport(reportID: String, status: ReportStatus) {
        guard let reportIndex = reports.firstIndex(where: { $0.id == reportID }) else { return }
        reports[reportIndex].status = status
        reports[reportIndex].adminResult = status.rawValue
        reports[reportIndex].handledAt = Date()
        if case .post(let postID) = reports[reportIndex].target,
           let postIndex = posts.firstIndex(where: { $0.id == postID }) {
            switch status {
            case .hidden:
                posts[postIndex].status = .hidden
            case .removed:
                posts[postIndex].status = .removed
            case .warned, .ignored, .pending:
                break
            }
        }
        showToast("处理结果：\(status.rawValue)")
    }

    func copyToPasteboard(_ value: String, label: String) {
        guard requireLogin(prompt: "登录后才能复制内容") else { return }
        UIPasteboard.general.string = value
        showToast("已复制\(label)")
    }

    // MARK: - Profile

    func posts(tagged tag: String) -> [GroupBuyPost] {
        sortedFeedPosts(activePosts
            .filter { $0.categoryTags.contains(tag) || $0.fandomTags.contains(tag) || $0.title.localizedCaseInsensitiveContains(tag) }
        )
    }

    func canChangeNickname(for user: User) -> Bool {
        guard let lastChangedAt = user.lastNicknameChangedAt,
              let nextAvailableDate = Calendar.current.date(byAdding: .month, value: 4, to: lastChangedAt) else {
            return true
        }
        return Date() >= nextAvailableDate
    }

    func nextNicknameChangeDate(for user: User) -> Date? {
        guard let lastChangedAt = user.lastNicknameChangedAt else { return nil }
        return Calendar.current.date(byAdding: .month, value: 4, to: lastChangedAt)
    }

    func updateCurrentBio(_ bio: String) {
        guard let index = users.firstIndex(where: { $0.id == currentUserID }) else { return }
        var updatedUser = users[index]
        updatedUser.bio = bio.trimmed.isEmpty ? "点击这里，填写简介" : bio.trimmed
        if isBackendEnabled {
            runSessionTask { [self] session in
                guard let backendToken else { return }
                do {
                    let response = try await backendClient.updateProfile(token: backendToken, user: updatedUser)
                    guard isCurrentSession(session) else { return }
                    if let userIndex = users.firstIndex(where: { $0.id == response.user.id }) {
                        users[userIndex] = response.user.localUser()
                    }
                    await refreshFromBackend(silent: true)
                    guard isCurrentSession(session) else { return }
                    showToast(response.moderation?.userMessage ?? "简介已保存")
                } catch {
                    guard isCurrentSession(session) else { return }
                    showToast(error.localizedDescription)
                }
            }
            return
        }
        users[index] = updatedUser
        showToast("简介已保存")
    }

    func updateCurrentProfile(nickname: String, redBookID: String, bio: String, gender: String, birthday: String, region: String, avatarSymbol: String, avatarTint: ColorToken, backgroundImageName: String, avatarImageData: Data?, backgroundImageData: Data?) {
        guard let index = users.firstIndex(where: { $0.id == currentUserID }) else { return }
        var rejectedNicknameChange = false
        let trimmedNickname = nickname.trimmed
        var proposedUser = users[index]
        if !trimmedNickname.isEmpty && trimmedNickname != proposedUser.nickname {
            if canChangeNickname(for: proposedUser) {
                proposedUser.nickname = trimmedNickname
                proposedUser.lastNicknameChangedAt = Date()
            } else {
                rejectedNicknameChange = true
            }
        }
        proposedUser.redBookID = redBookID.trimmed
        proposedUser.bio = bio.trimmed.isEmpty ? "点击这里，填写简介" : bio.trimmed
        proposedUser.gender = gender.trimmed
        proposedUser.birthday = birthday.trimmed
        proposedUser.region = region.trimmed
        proposedUser.avatarSymbol = avatarSymbol.trimmed.isEmpty ? proposedUser.avatarSymbol : String(avatarSymbol.trimmed.prefix(1))
        proposedUser.avatarTint = avatarTint
        proposedUser.backgroundImageName = backgroundImageName
        let avatarUploadData = avatarImageData
        let backgroundUploadData = backgroundImageData

        if isBackendEnabled {
            runSessionTask { [self] session in
                guard let backendToken else { return }
                do {
                    var avatarObjectKey: String?
                    if let avatarUploadData {
                        avatarObjectKey = try await backendClient.uploadProfileImage(token: backendToken, data: avatarUploadData, kind: "avatar")
                        guard isCurrentSession(session) else { return }
                    }
                    var backgroundObjectKey: String?
                    if let backgroundUploadData {
                        backgroundObjectKey = try await backendClient.uploadProfileImage(token: backendToken, data: backgroundUploadData, kind: "background")
                        guard isCurrentSession(session) else { return }
                    }
                    let response = try await backendClient.updateProfile(
                        token: backendToken,
                        user: proposedUser,
                        avatarObjectKey: avatarObjectKey,
                        backgroundObjectKey: backgroundObjectKey
                    )
                    guard isCurrentSession(session) else { return }
                    if let userIndex = users.firstIndex(where: { $0.id == response.user.id }) {
                        users[userIndex] = response.user.localUser()
                    }
                    await refreshFromBackend(silent: true)
                    guard isCurrentSession(session) else { return }
                    showToast(rejectedNicknameChange ? "资料已保存，昵称四个月内只能修改一次" : response.moderation?.userMessage ?? "资料已保存")
                } catch {
                    guard isCurrentSession(session) else { return }
                    showToast(error.localizedDescription)
                }
            }
            return
        }

        proposedUser.avatarImageData = avatarImageData
        proposedUser.backgroundImageData = backgroundImageData
        users[index] = proposedUser
        showToast(rejectedNicknameChange ? "资料已保存，昵称四个月内只能修改一次" : "资料已保存")
    }

    // MARK: - Authentication

    func setLoginState(_ loggedIn: Bool) {
        if loggedIn {
            logInDemoAccount(provider: "账号")
        } else {
            logOut()
        }
    }

    // MARK: - Account Deletion & Blocking

    func isBlocked(_ userID: String) -> Bool {
        blockedUserIDs.contains(userID)
    }

    func canShowContent(from userID: String) -> Bool {
        userID == currentUserID || (!blockedUserIDs.contains(userID) && !blockedByUserIDs.contains(userID))
    }

    func loadBlockedUsers() async {
        let session = authSessionVersion
        guard isBackendEnabled, let token = backendToken else { return }
        guard let blocked = try? await backendClient.blockedUsers(token: token) else { return }
        guard isCurrentSession(session) else { return }
        mergeUsers(blocked)
        blockedUserIDs = Set(blocked.map(\.id))
    }

    func blockUser(_ userID: String) async {
        let session = authSessionVersion
        guard userID != currentUserID else { return }
        guard requireLogin(prompt: "登录后才能拉黑") else { return }
        guard let token = cloudMutationToken(missingMessage: "云端登录状态异常，请重新登录后再拉黑") else {
            if canApplyLocalOnlyAccountMutation {
                applyLocalBlock(userID)
                showToast("已拉黑，对方将无法私信你")
            }
            return
        }
        do {
            try await backendClient.blockUser(token: token, userID: userID)
            guard isCurrentSession(session) else { return }
            applyLocalBlock(userID)
            showToast("已拉黑，对方将无法私信你")
        } catch {
            guard isCurrentSession(session) else { return }
            showToast(error.localizedDescription)
        }
    }

    func unblockUser(_ userID: String) async {
        let session = authSessionVersion
        guard requireLogin(prompt: "登录后才能管理拉黑") else { return }
        guard let token = cloudMutationToken(missingMessage: "云端登录状态异常，请重新登录后再管理拉黑") else {
            if canApplyLocalOnlyAccountMutation {
                blockedUserIDs.remove(userID)
                showToast("已解除拉黑")
                await restoreVisibleContentAfterUnblock()
            }
            return
        }
        do {
            try await backendClient.unblockUser(token: token, userID: userID)
            guard isCurrentSession(session) else { return }
            blockedUserIDs.remove(userID)
            showToast("已解除拉黑")
            await restoreVisibleContentAfterUnblock()
        } catch {
            guard isCurrentSession(session) else { return }
            showToast(error.localizedDescription)
        }
    }

    private var canApplyLocalOnlyAccountMutation: Bool {
        !isBackendEnabled && isLoggedIn
    }

    private func cloudMutationToken(missingMessage: String) -> String? {
        guard isBackendEnabled else { return nil }
        guard let token = backendToken else {
            invalidateCloudSessionForMissingToken(prompt: true, toast: missingMessage)
            return nil
        }
        return token
    }

    private func applyLocalBlock(_ userID: String) {
        let currentIndex = users.firstIndex(where: { $0.id == currentUserID })
        let targetIndex = users.firstIndex(where: { $0.id == userID })
        let removedCurrentFollow = followedUserIDs.remove(userID) != nil
        let hadTargetFollowingIDs = followingIDsByUserID[userID] != nil
        var targetFollowingIDs = followingIDsByUserID[userID] ?? []
        let removedTargetFollow = targetFollowingIDs.remove(currentUserID) != nil

        blockedUserIDs.insert(userID)
        followingIDsByUserID[currentUserID] = followedUserIDs
        if hadTargetFollowingIDs {
            followingIDsByUserID[userID] = targetFollowingIDs
        }

        if let currentIndex {
            users[currentIndex].followingCount = followedUserIDs.count
            if removedTargetFollow {
                users[currentIndex].followersCount = max(0, users[currentIndex].followersCount - 1)
            }
        }
        if let targetIndex {
            if hadTargetFollowingIDs {
                users[targetIndex].followingCount = targetFollowingIDs.count
            }
            if removedCurrentFollow {
                users[targetIndex].followersCount = max(0, users[targetIndex].followersCount - 1)
            }
        }
    }

    private func restoreVisibleContentAfterUnblock() async {
        let session = authSessionVersion
        guard isBackendEnabled else { return }
        if backendToken != nil {
            await refreshFromBackend(silent: true)
            guard isCurrentSession(session) else { return }
            return
        }
        do {
            let payload = try await backendClient.feed(limit: 80)
            guard isCurrentSession(session) else { return }
            applyPublicFeedPayload(payload)
        } catch {
            guard isCurrentSession(session) else { return }
            // Best-effort public refresh for debug/local-token-missing sessions.
        }
    }

    @discardableResult
    func deleteAccount() async -> Bool {
        let session = authSessionVersion
        guard isBackendEnabled, let token = backendToken else {
            showToast("请先登录后再操作")
            return false
        }
        do {
            try await backendClient.deleteAccount(token: token)
            guard isCurrentSession(session) else { return false }
            logOut()
            showToast("账号已删除")
            return true
        } catch {
            guard isCurrentSession(session) else { return false }
            showToast(error.localizedDescription)
            return false
        }
    }

    func logOut() {
        invalidateSessionWork()
        SyncCursorStore.remove(for: currentUserID)
        isLoggedIn = false
        isAuthPromptPresented = false
        backendToken = nil
        users = [Self.blankUser]
        currentUserID = Self.demoUserID
        posts.removeAll()
        collections.removeAll()
        reviews.removeAll()
        comments.removeAll()
        threads.removeAll()
        reports.removeAll()
        moderationReviews.removeAll()
        reminders.removeAll()
        likedPostIDs.removeAll()
        favoritePostIDs.removeAll()
        followedUserIDs.removeAll()
        blockedUserIDs.removeAll()
        blockedByUserIDs.removeAll()
        followingIDsByUserID = [Self.demoUserID: []]
        browsingHistoryIDs.removeAll()
        showToast("已退出当前账号")
    }

    func logInDemoAccount(provider: String) {
        switchCurrentUser(to: Self.demoUserID)
        showToast("已通过\(provider)登录")
    }

    @discardableResult
    func requestEmailCode(email: String, purpose: String) async -> Bool {
        let session = authSessionVersion
        let trimmedEmail = email.trimmed
        guard isBackendEnabled else {
            showToast("当前模式不需要邮箱验证码")
            return false
        }
        guard trimmedEmail.contains("@") else {
            showToast("请填写有效邮箱")
            return false
        }
        do {
            try await backendClient.sendEmailCode(email: trimmedEmail, purpose: purpose)
            guard isCurrentSession(session) else { return false }
            showToast("验证码已发送，请查看邮箱")
            return true
        } catch {
            guard isCurrentSession(session) else { return false }
            showToast(error.localizedDescription)
            return false
        }
    }

    @discardableResult
    func registerAccount(nickname: String, email: String, password: String, code: String = "") async -> Bool {
        let session = authSessionVersion
        let attempt = UUID()
        authenticationAttempt = attempt
        let trimmedNickname = nickname.trimmed
        let trimmedEmail = email.trimmed
        let trimmedPassword = password.trimmed
        let trimmedCode = code.trimmed

        if isBackendEnabled {
            guard !trimmedNickname.isEmpty else {
                showToast("请填写昵称")
                return false
            }
            guard trimmedEmail.contains("@") else {
                showToast("请填写有效邮箱")
                return false
            }
            guard trimmedPassword.count >= 8 else {
                showToast("密码至少 8 位")
                return false
            }
            guard trimmedCode.count == 6 else {
                showToast("请填写 6 位验证码")
                return false
            }
            do {
                let payload = try await backendClient.registerWithEmailCode(email: trimmedEmail, password: trimmedPassword, nickname: trimmedNickname, code: trimmedCode)
                guard isCurrentSession(session), authenticationAttempt == attempt else { return false }
                applyBackendPayload(payload)
                showToast("注册成功，已登录云端账号")
                return true
            } catch {
                guard isCurrentSession(session), authenticationAttempt == attempt else { return false }
                showToast(error.localizedDescription)
                return false
            }
        }

        guard !trimmedNickname.isEmpty else {
            showToast("请填写昵称")
            return false
        }
        guard trimmedEmail.count >= 6 else {
            showToast("请填写有效手机号")
            return false
        }
        guard trimmedPassword.count >= 8 else {
            showToast("密码至少 8 位")
            return false
        }
        guard !users.contains(where: { $0.phoneNumber == trimmedEmail }) else {
            showToast("该手机号已注册")
            return false
        }

        let userID = "u-\(UUID().uuidString)"
        let avatarSymbol = String(trimmedNickname.prefix(1))
        let user = User(
            id: userID,
            nickname: trimmedNickname,
            bio: "点击这里，填写简介",
            followingCount: 0,
            followersCount: 0,
            postCount: 0,
            isRestricted: false,
            canShowContact: true,
            avatarSymbol: avatarSymbol.isEmpty ? "新" : avatarSymbol,
            avatarTint: .rose,
            redBookID: String(trimmedEmail.suffix(8)),
            gender: "未设置",
            birthday: "选择生日",
            region: "未设置",
            backgroundImageName: "merch_magazine",
            phoneNumber: trimmedEmail,
            password: trimmedPassword
        )

        users.append(user)
        followingIDsByUserID[userID] = []
        switchCurrentUser(to: userID)
        showToast("注册成功，已登录")
        return true
    }

    @discardableResult
    func loginWithEmail(email: String, password: String) async -> Bool {
        let session = authSessionVersion
        let attempt = UUID()
        authenticationAttempt = attempt
        let trimmedEmail = email.trimmed
        let trimmedPassword = password.trimmed
        if isBackendEnabled {
            do {
                let payload = try await backendClient.login(email: trimmedEmail, password: trimmedPassword)
                guard isCurrentSession(session), authenticationAttempt == attempt else { return false }
                applyBackendPayload(payload)
                showToast("云端登录成功")
                return true
            } catch {
                guard isCurrentSession(session), authenticationAttempt == attempt else { return false }
                let message = error.localizedDescription == "邮箱或密码不正确" ? "密码和邮箱不匹配" : error.localizedDescription
                showToast(message)
                return false
            }
        }
        guard let user = users.first(where: { $0.phoneNumber == trimmedEmail && $0.password == trimmedPassword }) else {
            showToast("手机号或密码不正确")
            return false
        }
        switchCurrentUser(to: user.id)
        showToast("登录成功")
        return true
    }

    @discardableResult
    func loginWithEmailCode(email: String, code: String) async -> Bool {
        let session = authSessionVersion
        let attempt = UUID()
        authenticationAttempt = attempt
        let trimmedEmail = email.trimmed
        let trimmedCode = code.trimmed
        guard isBackendEnabled else {
            showToast("本地模式不支持验证码登录")
            return false
        }
        guard trimmedEmail.contains("@") else {
            showToast("请填写有效邮箱")
            return false
        }
        guard trimmedCode.count == 6 else {
            showToast("请填写 6 位验证码")
            return false
        }
        do {
            let payload = try await backendClient.loginWithEmailCode(email: trimmedEmail, code: trimmedCode)
            guard isCurrentSession(session), authenticationAttempt == attempt else { return false }
            applyBackendPayload(payload)
            showToast("验证码登录成功")
            return true
        } catch {
            guard isCurrentSession(session), authenticationAttempt == attempt else { return false }
            showToast(error.localizedDescription)
            return false
        }
    }

    private func switchCurrentUser(to userID: String) {
        guard users.contains(where: { $0.id == userID }) else { return }
        invalidateSessionWork()
        UserDefaults.standard.set(browsingHistoryIDs, forKey: Self.browsingHistoryDefaultsKey(for: currentUserID))
        currentUserID = userID
        browsingHistoryIDs = UserDefaults.standard.stringArray(forKey: Self.browsingHistoryDefaultsKey(for: userID)) ?? []
        followedUserIDs = followingIDsByUserID[userID] ?? []
        followingIDsByUserID[userID] = followedUserIDs
        likedPostIDs = []
        favoritePostIDs = []
        isLoggedIn = true
        isAuthPromptPresented = false
    }

    // MARK: - Messages

    func sharePostToThread(postID: String, threadID: String) {
        guard requireLogin(prompt: "登录后才能私信分享") else { return }
        guard let post = post(id: postID),
              let index = threads.firstIndex(where: { $0.id == threadID && isCurrentUserThread($0) }) else { return }
        let message = DirectMessage(
            id: "m-\(UUID().uuidString)",
            senderID: currentUserID,
            body: "分享了制品：\(post.title)",
            createdAt: Date(),
            sharedPostID: postID
        )
        threads[index].messages.append(message)
        threads[index].updatedAt = Date()
        threads[index].unreadCount = 0
        let thread = threads[index]
        persistThreads()
        syncMessageToBackendIfNeeded(thread: thread, message: message, successToast: "已分享给站内好友")
    }

    func sharePostToUser(postID: String, userID: String) {
        guard requireLogin(prompt: "登录后才能私信分享") else { return }
        guard let threadID = threadID(forRecipient: userID, relatedPostID: postID) else { return }
        sharePostToThread(postID: postID, threadID: threadID)
    }

    func shareProfileToThread(userID: String, threadID: String) {
        guard requireLogin(prompt: "登录后才能私信分享") else { return }
        guard let user = users.first(where: { $0.id == userID }),
              let index = threads.firstIndex(where: { $0.id == threadID && isCurrentUserThread($0) }) else { return }
        let message = DirectMessage(
            id: "m-\(UUID().uuidString)",
            senderID: currentUserID,
            body: "分享了主页：\(user.nickname)",
            createdAt: Date(),
            sharedProfileUserID: userID
        )
        threads[index].messages.append(message)
        threads[index].updatedAt = Date()
        threads[index].unreadCount = 0
        let thread = threads[index]
        persistThreads()
        syncMessageToBackendIfNeeded(thread: thread, message: message, successToast: "已分享给站内好友")
    }

    func shareProfileToUser(profileUserID: String, recipientUserID: String) {
        guard requireLogin(prompt: "登录后才能私信分享") else { return }
        guard let threadID = threadID(forRecipient: recipientUserID, relatedPostID: nil) else { return }
        shareProfileToThread(userID: profileUserID, threadID: threadID)
    }

    func consultationThreadID(for postID: String) -> String? {
        guard requireLogin(prompt: "登录后才能发私信") else { return nil }
        guard let post = post(id: postID) else { return nil }
        return threadID(forRecipient: post.authorID, relatedPostID: postID)
    }

    func directMessageThreadID(for userID: String) -> String? {
        guard requireLogin(prompt: "登录后才能发私信") else { return nil }
        return threadID(forRecipient: userID, relatedPostID: nil)
    }

    func directMessageThreadRouteID(for userID: String) -> String? {
        guard isLoggedIn, userID != currentUserID else { return nil }
        if let existing = messageThreads.first(where: { peerUserID(for: $0) == userID }) {
            return existing.id
        }
        if let existing = threads.first(where: { isCurrentUserThread($0) && peerUserID(for: $0) == userID }) {
            return existing.id
        }
        return stableThreadID(forRecipient: userID)
    }

    func ensureMutualFriendThreads() {
        guard !isBackendEnabled else { return }
        for friend in mutualFriendUsers() where !threads.contains(where: { isCurrentUserThread($0) && peerUserID(for: $0) == friend.id && $0.relatedPostID == nil }) {
            let threadID = "t-\(UUID().uuidString)"
            let thread = MessageThread(
                id: threadID,
                buyerUserID: currentUserID,
                publisherUserID: friend.id,
                relatedPostID: nil,
                messages: [],
                unreadCount: 0,
                updatedAt: Date.distantPast
            )
            threads.append(thread)
        }
        persistThreads()
    }

    private func threadID(forRecipient userID: String, relatedPostID: String?) -> String? {
        guard requireLogin(prompt: "登录后才能发私信") else { return nil }
        guard userID != currentUserID else { return nil }
        if let existing = messageThreads.first(where: { peerUserID(for: $0) == userID }) {
            return existing.id
        }
        if let existing = threads.first(where: { isCurrentUserThread($0) && peerUserID(for: $0) == userID }) {
            return existing.id
        }
        let threadID = stableThreadID(forRecipient: userID)
        if threads.contains(where: { $0.id == threadID }) {
            return threadID
        }
        let thread = MessageThread(
            id: threadID,
            buyerUserID: currentUserID,
            publisherUserID: userID,
            relatedPostID: relatedPostID,
            messages: [],
            unreadCount: 0,
            updatedAt: Date()
        )
        threads.insert(thread, at: 0)
        persistThreads()
        return threadID
    }

    private func stableThreadID(forRecipient userID: String) -> String {
        let pair = [currentUserID, userID].sorted().joined(separator: "-")
        return "t-dm-\(pair)"
    }

    func sendMessage(threadID: String, body: String) -> Bool {
        guard requireLogin(prompt: "登录后才能发私信") else { return false }
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let index = threads.firstIndex(where: { $0.id == threadID && isCurrentUserThread($0) }) else { return false }
        if let failureStatus = localBlockFailureStatus(forPeer: peerUserID(for: threads[index])) {
            appendFailedMessage(
                DirectMessage(id: "m-\(UUID().uuidString)", senderID: currentUserID, body: trimmed, createdAt: Date(), deliveryStatus: failureStatus),
                toThreadAt: index
            )
            return true
        }
        guard canSendMessage(in: threads[index]) else {
            showToast("对方未关注你前最多发送两条消息")
            return false
        }
        guard canAttemptCloudMessage() else { return false }
        let message = DirectMessage(id: "m-\(UUID().uuidString)", senderID: currentUserID, body: trimmed, createdAt: Date())
        threads[index].messages.append(message)
        threads[index].updatedAt = Date()
        threads[index].unreadCount = 0
        let thread = threads[index]
        persistThreads()
        syncMessageToBackendIfNeeded(thread: thread, message: message)
        return true
    }

    func sendImageMessage(threadID: String, imageData: Data) -> Bool {
        guard requireLogin(prompt: "登录后才能发私信") else { return false }
        guard let index = threads.firstIndex(where: { $0.id == threadID && isCurrentUserThread($0) }) else { return false }
        let storedImageData = Self.normalizedMessageImageData(imageData)
        if let failureStatus = localBlockFailureStatus(forPeer: peerUserID(for: threads[index])) {
            appendFailedMessage(
                DirectMessage(id: "m-\(UUID().uuidString)", senderID: currentUserID, body: "[图片]", createdAt: Date(), imageData: storedImageData, deliveryStatus: failureStatus),
                toThreadAt: index
            )
            return true
        }
        guard canSendMessage(in: threads[index]) else {
            showToast("对方未关注你前最多发送两条消息")
            return false
        }
        guard canAttemptCloudMessage() else { return false }
        let message = DirectMessage(
            id: "m-\(UUID().uuidString)",
            senderID: currentUserID,
            body: "[图片]",
            createdAt: Date(),
            imageData: storedImageData
        )
        threads[index].messages.append(message)
        threads[index].updatedAt = Date()
        threads[index].unreadCount = 0
        let thread = threads[index]
        persistThreads()
        syncMessageToBackendIfNeeded(thread: thread, message: message)
        return true
    }

    private func appendFailedMessage(_ message: DirectMessage, toThreadAt index: Int) {
        threads[index].messages.append(message)
        threads[index].updatedAt = Date()
        persistThreads()
    }

    func retryFailedMessage(threadID: String, messageID: String) {
        guard let threadIndex = localThreadIndex(threadID: threadID, messageID: messageID),
              let messageIndex = threads[threadIndex].messages.firstIndex(where: { $0.id == messageID }),
              threads[threadIndex].messages[messageIndex].deliveryStatus.isFailed else { return }
        if let failureStatus = localBlockFailureStatus(forPeer: peerUserID(for: threads[threadIndex])) {
            threads[threadIndex].messages[messageIndex].deliveryStatus = failureStatus
            persistThreads()
            if failureStatus == .failedBlockedByPeer {
                showToast("你已被对方拉黑，无法发送消息")
            } else {
                showToast("你已拉黑对方，解除拉黑后才能发送")
            }
            return
        }
        guard canSendMessage(in: threads[threadIndex]) else {
            showToast("对方未关注你前最多发送两条消息")
            return
        }
        guard canAttemptCloudMessage() else { return }
        var message = threads[threadIndex].messages.remove(at: messageIndex)
        message.deliveryStatus = .sent
        message.createdAt = Date()
        threads[threadIndex].messages.append(message)
        threads[threadIndex].updatedAt = Date()
        let thread = threads[threadIndex]
        persistThreads()
        syncMessageToBackendIfNeeded(thread: thread, message: message)
    }

    private func localBlockFailureStatus(forPeer peerID: String) -> MessageDeliveryStatus? {
        // 双方互拉时「你已被对方拉黑」优先展示。
        if blockedByUserIDs.contains(peerID) { return .failedBlockedByPeer }
        if blockedUserIDs.contains(peerID) { return .failedBlockedPeer }
        return nil
    }

    private func blockedSendFailureStatus(_ error: Error, recipientUserID: String) -> MessageDeliveryStatus? {
        let nsError = error as NSError
        guard nsError.domain == "AliyunBackendClient" else { return nil }
        switch nsError.userInfo[AliyunBackendClient.errorCodeUserInfoKey] as? String {
        case "blocked_by_recipient": return .failedBlockedByPeer
        case "blocked_recipient": return .failedBlockedPeer
        default: break
        }
        // 旧版后端无 code 字段时按文案兜底，方向靠本地拉黑状态推断。
        if nsError.code == 400 && nsError.localizedDescription == "无法向该用户发送消息" {
            return isBlocked(recipientUserID) ? .failedBlockedPeer : .failedBlockedByPeer
        }
        return nil
    }

    private func canAttemptCloudMessage() -> Bool {
        guard isBackendEnabled else { return true }
        guard backendToken != nil else {
            invalidateCloudSessionForMissingToken(prompt: true, toast: "云端登录状态异常，请重新登录后再发私信")
            return false
        }
        return true
    }

    private func syncMessageToBackendIfNeeded(thread: MessageThread, message: DirectMessage, successToast: String? = nil) {
        guard isBackendEnabled else {
            if let successToast {
                showToast(successToast)
            }
            return
        }
        guard let backendToken else {
            updateLocalMessage(threadID: thread.id, messageID: message.id) { localMessage in
                localMessage.deliveryStatus = .failedNetwork
            }
            invalidateCloudSessionForMissingToken(prompt: true, toast: "云端登录状态异常，请重新登录后再发私信")
            return
        }
        let recipientUserID = peerUserID(for: thread)
        runSessionTask { [self] session in
            do {
                var outgoingMessage = message
                if let imageData = outgoingMessage.imageData, outgoingMessage.imageObjectKey.isEmpty {
                    let objectKey = try await backendClient.uploadMessageImage(token: backendToken, data: imageData)
                    guard isCurrentSession(session) else { return }
                    outgoingMessage.imageObjectKey = objectKey
                    updateLocalMessage(threadID: thread.id, messageID: outgoingMessage.id) { localMessage in
                        localMessage.imageObjectKey = objectKey
                    }
                }
                let response = try await backendClient.sendDirectMessage(token: backendToken, thread: thread, recipientUserID: recipientUserID, message: outgoingMessage)
                guard isCurrentSession(session) else { return }
                mergeChangedMessageThreads(from: [response.thread.localThread()])
                await syncFromBackend(reason: "message.sent")
                guard isCurrentSession(session) else { return }
                if let successToast {
                    showToast(successToast)
                }
            } catch {
                guard isCurrentSession(session) else { return }
                if let failureStatus = blockedSendFailureStatus(error, recipientUserID: recipientUserID) {
                    if failureStatus == .failedBlockedByPeer {
                        blockedByUserIDs.insert(recipientUserID)
                    }
                    updateLocalMessage(threadID: thread.id, messageID: message.id) { localMessage in
                        localMessage.deliveryStatus = failureStatus
                    }
                    return
                }
                updateLocalMessage(threadID: thread.id, messageID: message.id) { localMessage in
                    localMessage.deliveryStatus = .failedNetwork
                }
                showToast(error.localizedDescription)
                await refreshFromBackend(silent: true)
                guard isCurrentSession(session) else { return }
            }
        }
    }

    private func updateLocalMessage(threadID: String, messageID: String, update: (inout DirectMessage) -> Void) {
        guard let threadIndex = localThreadIndex(threadID: threadID, messageID: messageID),
              let messageIndex = threads[threadIndex].messages.firstIndex(where: { $0.id == messageID }) else { return }
        update(&threads[threadIndex].messages[messageIndex])
        persistThreads()
    }

    private func localThreadIndex(threadID: String, messageID: String? = nil) -> Int? {
        if let index = threads.firstIndex(where: { $0.id == threadID && isCurrentUserThread($0) }) {
            return index
        }
        if let messageID {
            return threads.firstIndex { thread in
                isCurrentUserThread(thread) && thread.messages.contains(where: { $0.id == messageID })
            }
        }
        return nil
    }

    private func canSendMessage(in thread: MessageThread) -> Bool {
        guard limitsUnrepliedMessages else { return true }
        let peerFollowsCurrentUser = followingIDs(for: peerUserID(for: thread)).contains(currentUserID)
        guard !peerFollowsCurrentUser else { return true }
        let ownSentMessagesBeforeFollow = thread.messages
            .filter { !$0.deliveryStatus.isFailed }
            .filter { $0.senderID == currentUserID }
            .count
        return ownSentMessagesBeforeFollow < 2
    }

    func markThreadRead(threadID: String) {
        guard let index = threads.firstIndex(where: { $0.id == threadID && isCurrentUserThread($0) }),
              threads[index].unreadCount > 0 else { return }
        threads[index].unreadCount = 0
        persistThreads()
        if isBackendEnabled, let backendToken {
            runSessionTask { [self] session in
                try? await backendClient.markDirectMessageThreadRead(token: backendToken, threadID: threadID)
                guard isCurrentSession(session) else { return }
                await syncFromBackend(reason: "message.read")
                guard isCurrentSession(session) else { return }
            }
        }
    }

    func canRevokeMessage(_ message: DirectMessage) -> Bool {
        message.senderID == currentUserID && Date().timeIntervalSince(message.createdAt) <= 120
    }

    func deleteMessage(threadID: String, messageID: String) {
        guard let threadIndex = localThreadIndex(threadID: threadID, messageID: messageID),
              let messageIndex = threads[threadIndex].messages.firstIndex(where: { $0.id == messageID }) else { return }
        let actualThreadID = threads[threadIndex].id
        threads[threadIndex].messages[messageIndex].isDeletedForMe = true
        threads[threadIndex].updatedAt = Date()
        persistThreads()
        showToast("已从你的聊天中删除")
        guard isBackendEnabled, let backendToken else { return }
        runSessionTask { [self] session in
            do {
                let response = try await backendClient.deleteDirectMessage(token: backendToken, threadID: actualThreadID, messageID: messageID)
                guard isCurrentSession(session) else { return }
                mergeChangedMessageThreads(from: [response.thread.localThread()])
                await syncFromBackend(reason: "message.deleted")
                guard isCurrentSession(session) else { return }
            } catch {
                guard isCurrentSession(session) else { return }
                showToast(error.localizedDescription)
                await refreshFromBackend(silent: true)
                guard isCurrentSession(session) else { return }
            }
        }
    }

    func revokeMessage(threadID: String, messageID: String) {
        guard let threadIndex = localThreadIndex(threadID: threadID, messageID: messageID),
              let messageIndex = threads[threadIndex].messages.firstIndex(where: { $0.id == messageID }) else { return }
        guard canRevokeMessage(threads[threadIndex].messages[messageIndex]) else {
            showToast("只能撤回 2 分钟内发送的消息")
            return
        }
        let actualThreadID = threads[threadIndex].id
        threads[threadIndex].messages[messageIndex].isRevoked = true
        threads[threadIndex].updatedAt = Date()
        persistThreads()
        showToast("已撤回")
        guard isBackendEnabled, let backendToken else { return }
        runSessionTask { [self] session in
            do {
                let response = try await backendClient.revokeDirectMessage(token: backendToken, threadID: actualThreadID, messageID: messageID)
                guard isCurrentSession(session) else { return }
                mergeChangedMessageThreads(from: [response.thread.localThread()])
                await syncFromBackend(reason: "message.revoked")
                guard isCurrentSession(session) else { return }
            } catch {
                guard isCurrentSession(session) else { return }
                showToast(error.localizedDescription)
                await refreshFromBackend(silent: true)
                guard isCurrentSession(session) else { return }
            }
        }
    }

    // MARK: - Collections and Posts

    @discardableResult
    func createCollection(name: String, wechat: String, qq: String, groupNumber: String, groupInfo: String, deadline: Date, defaultNote: String) -> String? {
        let trimmedName = name.trimmed
        guard !trimmedName.isEmpty else {
            showToast("请先填写合集名称")
            return nil
        }
        guard !wechat.trimmed.isEmpty || !qq.trimmed.isEmpty || !groupNumber.trimmed.isEmpty else {
            showToast("微信、QQ、QQ群号至少填写一个")
            return nil
        }
        let collection = GroupCollection(
            id: "col-\(UUID().uuidString)",
            ownerID: currentUserID,
            name: trimmedName,
            contactWechat: wechat.trimmed,
            contactQQ: qq.trimmed,
            contactGroupNumber: groupNumber.trimmed,
            groupInfo: groupInfo.trimmed,
            deadline: deadline,
            defaultNote: defaultNote.trimmed.isEmpty ? "该合集内帖子共享联系方式、截团时间和默认说明。" : defaultNote.trimmed,
            postIDs: [],
            createdAt: Date()
        )
        collections.insert(collection, at: 0)
        showToast("已创建拼团合集")
        runBackendMutation { [self] token, session in
            try await self.backendClient.createCollection(token: token, collection: collection)
            guard isCurrentSession(session) else { return }
        }
        return collection.id
    }

    func updateCollection(id: String, name: String, wechat: String, qq: String, groupNumber: String, groupInfo: String, deadline: Date, defaultNote: String) {
        guard let index = collections.firstIndex(where: { $0.id == id && $0.ownerID == currentUserID }) else { return }
        guard !name.trimmed.isEmpty else {
            showToast("请先填写合集名称")
            return
        }
        guard !wechat.trimmed.isEmpty || !qq.trimmed.isEmpty || !groupNumber.trimmed.isEmpty else {
            showToast("微信、QQ、QQ群号至少填写一个")
            return
        }
        guard !defaultNote.trimmed.isEmpty else {
            showToast("请填写默认说明")
            return
        }
        var updated = collections[index]
        updated.name = name.trimmed
        updated.contactWechat = wechat.trimmed
        updated.contactQQ = qq.trimmed
        updated.contactGroupNumber = groupNumber.trimmed
        updated.groupInfo = groupInfo.trimmed
        updated.deadline = deadline
        updated.defaultNote = defaultNote.trimmed.isEmpty ? "该合集内帖子共享联系方式、截团时间和默认说明。" : defaultNote.trimmed
        collections[index] = updated
        showToast("合集信息已保存")
        if isBackendEnabled {
            runSessionTask { [self] session in
                guard let backendToken else { return }
                do {
                    let response = try await backendClient.updateCollection(token: backendToken, collection: updated)
                    guard isCurrentSession(session) else { return }
                    mergeCollections([response.collection.localCollection()])
                    await syncFromBackend(reason: "collection.updated")
                    guard isCurrentSession(session) else { return }
                    showToast("合集信息已同步")
                } catch {
                    guard isCurrentSession(session) else { return }
                    showToast(error.localizedDescription)
                    await refreshFromBackend(silent: true)
                    guard isCurrentSession(session) else { return }
                }
            }
        }
    }

    func deleteCollections(ids: Set<String>) {
        let ownedIDs = Set(collections.filter { ids.contains($0.id) && $0.ownerID == currentUserID }.map(\.id))
        guard !ownedIDs.isEmpty else {
            showToast("请选择要删除的合集")
            return
        }
        collections.removeAll { ownedIDs.contains($0.id) }
        for index in posts.indices {
            if let collectionID = posts[index].collectionID, ownedIDs.contains(collectionID) {
                posts[index].collectionID = nil
            }
        }
        showToast("已删除 \(ownedIDs.count) 个拼团合集")
        runBackendMutation(refreshAfterFailure: true) { [self] token, session in
            for collectionID in ownedIDs {
                try await self.backendClient.deleteCollection(token: token, collectionID: collectionID)
                guard isCurrentSession(session) else { return }
            }
        }
    }

    func addPost(_ postID: String, to collectionID: String) {
        guard let collectionIndex = collections.firstIndex(where: { $0.id == collectionID }),
              let postIndex = posts.firstIndex(where: { $0.id == postID }) else { return }
        for index in collections.indices where collections[index].id != collectionID {
            collections[index].postIDs.removeAll { $0 == postID }
        }
        if !collections[collectionIndex].postIDs.contains(postID) {
            collections[collectionIndex].postIDs.append(postID)
        }
        posts[postIndex].collectionID = collectionID
        showToast("已加入合集")
    }

    func removePost(_ postID: String, from collectionID: String) {
        guard let collectionIndex = collections.firstIndex(where: { $0.id == collectionID }),
              let postIndex = posts.firstIndex(where: { $0.id == postID }) else { return }
        if posts[postIndex].collectionID == collectionID {
            showToast("帖子必须保留在一个合集里")
            return
        }
        collections[collectionIndex].postIDs.removeAll { $0 == postID }
        showToast("已移出合集")
    }

    func deleteOwnPost(postID: String) {
        guard let postIndex = posts.firstIndex(where: { $0.id == postID }),
              posts[postIndex].authorID == currentUserID else { return }
        markOwnPostDeleted(postID)
        showToast("帖子已删除")
        runBackendMutation(syncAfterSuccess: true) { [self] token, session in
            try await self.backendClient.deletePost(token: token, postID: postID)
            guard isCurrentSession(session) else { return }
        }
    }

    private func markOwnPostDeleted(_ postID: String) {
        guard let postIndex = posts.firstIndex(where: { $0.id == postID }),
              posts[postIndex].authorID == currentUserID else { return }
        posts[postIndex].status = .deleted
        likedPostIDs.remove(postID)
        favoritePostIDs.remove(postID)
        reminders.removeAll { $0.postID == postID }
        browsingHistoryIDs.removeAll { $0 == postID }
        for collectionIndex in collections.indices {
            collections[collectionIndex].postIDs.removeAll { $0 == postID }
        }
    }

    func addUnsoldRole(postID: String, name: String, quantity: Int, priceAdjustment: Double = 0) {
        let trimmed = name.trimmed
        guard !trimmed.isEmpty,
              quantity > 0,
              let index = posts.firstIndex(where: { $0.id == postID }) else { return }
        posts[index].unsoldRoles.append(UnsoldRole(name: trimmed, quantity: quantity, priceAdjustment: priceAdjustment))
        showToast("已更新角色余量")
    }

    func updateUnsoldRole(postID: String, roleID: String, name: String, quantity: Int, priceAdjustment: Double) {
        guard let postIndex = posts.firstIndex(where: { $0.id == postID }),
              let roleIndex = posts[postIndex].unsoldRoles.firstIndex(where: { $0.id == roleID }) else { return }
        posts[postIndex].unsoldRoles[roleIndex].name = name.trimmed
        posts[postIndex].unsoldRoles[roleIndex].quantity = max(0, quantity)
        posts[postIndex].unsoldRoles[roleIndex].priceAdjustment = priceAdjustment
    }

    func removeUnsoldRole(postID: String, roleID: String) {
        guard let postIndex = posts.firstIndex(where: { $0.id == postID }) else { return }
        posts[postIndex].unsoldRoles.removeAll { $0.id == roleID }
        showToast("已删除角色")
    }

    func createPost(title: String, groupType: GroupBuyType, collectionID: String, imageNames: [String], uploadedImageData: [Data], tags: [String], price: String, deposit: String, deadline: Date, condition: String, wechat: String, qq: String, groupInfo: String, description: String, pingguAveragePrice: String, pingguNote: String, unsoldRoles: [UnsoldRole], replacingPostID: String? = nil) {
        guard let inherited = collection(id: collectionID) else {
            showToast("请先选择拼团合集")
            return
        }
        let postID = "p-\(UUID().uuidString)"
        let post = GroupBuyPost(
            id: postID,
            title: title,
            imageNames: imageNames.isEmpty ? ["merch_photocards"] : imageNames,
            uploadedImageData: uploadedImageData,
            authorID: currentUserID,
            groupType: groupType,
            collectionID: inherited.id,
            categoryTags: tags,
            fandomTags: [],
            price: price,
            deposit: deposit,
            deadline: inherited.deadline,
            condition: condition,
            isFormed: false,
            description: description,
            wechat: inherited.contactWechat,
            qq: inherited.contactQQ,
            groupNumber: inherited.contactGroupNumber,
            groupInfo: inherited.groupInfo,
            externalLink: "",
            createdAt: Date(),
            likedCount: 0,
            favoriteCount: 0,
            commentCount: 0,
            reportCount: 0,
            status: .active,
            imageAspect: 1.08,
            pingguAveragePrice: groupType == .splitGoods ? pingguAveragePrice : "",
            pingguNote: groupType == .splitGoods ? pingguNote : "",
            unsoldRoles: groupType == .splitGoods ? unsoldRoles.filter(\.isAvailable) : []
        )
        if isBackendEnabled {
            runSessionTask { [self] session in
                guard let backendToken else { return }
                do {
                    async let uploadedObjectKeys = backendClient.uploadPostImages(token: backendToken, images: uploadedImageData)
                    async let uploadedPreviewObjectKeys = backendClient.uploadPostPreviewImages(token: backendToken, images: uploadedImageData)
                    let (objectKeys, previewObjectKeys) = try await (uploadedObjectKeys, uploadedPreviewObjectKeys)
                    guard isCurrentSession(session) else { return }
                    var remotePost = post
                    remotePost.imageObjectKeys = objectKeys
                    remotePost.previewImageObjectKeys = previewObjectKeys
                    let response = try await backendClient.createPost(token: backendToken, post: remotePost, imageObjectKeys: objectKeys, previewImageObjectKeys: previewObjectKeys)
                    guard isCurrentSession(session) else { return }
                    let localPost = response.post.localPost()
                    mergePosts([localPost])
                    if let collectionID = localPost.collectionID,
                       let index = collections.firstIndex(where: { $0.id == collectionID }),
                       !collections[index].postIDs.contains(localPost.id) {
                        collections[index].postIDs.insert(localPost.id, at: 0)
                    }
                    if let replacingPostID {
                        markOwnPostDeleted(replacingPostID)
                        do {
                            try await backendClient.deletePost(token: backendToken, postID: replacingPostID)
                            guard isCurrentSession(session) else { return }
                        } catch {
                            guard isCurrentSession(session) else { return }
                            showToast("新帖已发布，旧版本删除失败，请稍后刷新")
                        }
                    }
                    await syncFromBackend(reason: replacingPostID == nil ? "post.created" : "post.republished")
                    guard isCurrentSession(session) else { return }
                    showToast(response.moderation?.userMessage ?? "发布成功，已同步到云端")
                } catch {
                    guard isCurrentSession(session) else { return }
                    showToast(error.localizedDescription)
                }
            }
            return
        }
        posts.insert(post, at: 0)
        if let index = collections.firstIndex(where: { $0.id == inherited.id }) {
            collections[index].postIDs.insert(postID, at: 0)
        }
        if let replacingPostID {
            markOwnPostDeleted(replacingPostID)
        }
        showToast(replacingPostID == nil ? "发布成功，已进入\(groupType.moduleTitle)模块" : "已重新发布，旧版本已删除")
    }

    // MARK: - Toasts

    func showToast(_ message: String) {
        toastMessage = message
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            if self?.toastMessage == message {
                self?.toastMessage = nil
            }
        }
    }

    private static func date(days: Int, hour: Int) -> Date {
        let base = Calendar.current.date(byAdding: .day, value: days, to: Date()) ?? Date()
        return Calendar.current.date(bySettingHour: hour, minute: 0, second: 0, of: base) ?? base
    }
}
