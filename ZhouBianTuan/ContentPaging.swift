import SwiftUI

struct ContentQuery: Hashable {
    var path = "/feed"
    var parameters: [String: String] = [:]
    var key: String {
        var components = URLComponents()
        components.queryItems = parameters.keys.sorted().map { URLQueryItem(name: $0, value: parameters[$0]) }
        return path + "?" + (components.percentEncodedQuery ?? "")
    }
    var isThreadPage: Bool { path == "/messages/threads" }
    var isMessagePage: Bool { path.hasSuffix("/messages") }
    var isUserPage: Bool { path == "/users" }
    var isCollectionPage: Bool { path == "/collections" }
    var isCommentPage: Bool { path.hasSuffix("/comments") }
    static func author(_ id: String) -> Self { .init(parameters: ["authorID": id]) }
    static func collection(_ id: String) -> Self { .init(parameters: ["collectionID": id]) }
    static func collections(_ owner: String) -> Self { .init(path: "/collections", parameters: ["ownerID": owner]) }
    static func comments(_ postID: String) -> Self { .init(path: "/posts/\(postID)/comments") }
    static let favorites = Self(parameters: ["favorites": "true"])
    static let likes = Self(parameters: ["likes": "true"])
    static let threads = Self(path: "/messages/threads")
    static func messages(_ threadID: String) -> Self { .init(path: "/messages/threads/\(threadID)/messages") }
    static let following = Self(parameters: ["following": "true"])
}

struct ContentPageState {
    var ids: [String] = []
    var nextCursor: String?
    var hasMore = true
    var isLoaded = false
    var requestID: UUID?
    var error: String?
    var isOfflineSnapshot = false
    /// The server ranking seed for the current personalized feed snapshot.
    /// It is intentionally kept out of ContentQuery.key so offline restore
    /// remains stable while pagination stays pinned to one ordering.
    var feedRefreshSeed: String?
}

struct BackendContentPage: Decodable {
    var unreadMessageCount: Int?
    var unreadCursor: String?
    var posts: [BackendPost]?
    var users: [BackendUser]?
    var collections: [BackendCollection]?
    var comments: [BackendComment]?
    var thread: BackendMessageThread?
    var messageThreads: [BackendMessageThread]?
    var post: BackendPost?
    var nextCursor: String?
    var hasMore: Bool?
    var commentsNextCursor: String?
    var commentsHasMore: Bool?
}

extension AliyunBackendClient {
    func contentPage(_ query: ContentQuery, cursor: String?, token: String?, refreshSeed: String? = nil) async throws -> BackendContentPage {
        var parameters = query.parameters
        parameters["limit"] = "30"
        if let cursor { parameters["cursor"] = cursor }
        if let refreshSeed, !refreshSeed.isEmpty { parameters["refreshSeed"] = refreshSeed }
        var components = URLComponents()
        components.queryItems = parameters.keys.sorted().map { URLQueryItem(name: $0, value: parameters[$0]) }
        return try await request(query.path + "?" + (components.percentEncodedQuery ?? ""), token: token)
    }
    func postDetail(_ postID: String, token: String?) async throws -> BackendContentPage {
        try await request("/posts/\(postID)", token: token)
    }
}

extension MockAppStore {
    func pageState(_ query: ContentQuery) -> ContentPageState { contentPages[query.key] ?? ContentPageState() }

    func pagePosts(_ query: ContentQuery) -> [GroupBuyPost] {
        pageState(query).ids.compactMap { post(id: $0) }.filter { post in
            if post.status != .active && query.parameters["authorID"] != currentUserID { return false }
            if let collectionID = query.parameters["collectionID"], post.collectionID != collectionID { return false }
            if query.parameters["inStock"] == "true" && !post.unsoldRoles.contains(where: \.isAvailable) { return false }
            if query.parameters["roles"] == "true", let term = query.parameters["q"] {
                return post.unsoldRoles.contains { $0.isAvailable && $0.name.localizedCaseInsensitiveContains(term) }
            }
            return true
        }
    }
    func pageUsers(_ query: ContentQuery) -> [User] {
        pageState(query).ids.compactMap { id in users.first { $0.id == id && canShowContent(from: id) } }
    }
    func invalidateContentPages() {
        contentPages.removeAll()
        postDetailRequests.removeAll()
        contentPageEpoch = UUID()
    }

    func loadContentPage(_ query: ContentQuery, reset: Bool = false) async {
        guard isBackendEnabled else { return }
        var state = pageState(query)
        guard reset || (state.requestID == nil && state.hasMore) else { return }
        let refreshSeed: String?
        if reset, query.path == "/feed", query.parameters["feedMode"] == "forYou" {
            refreshSeed = UUID().uuidString.lowercased()
        } else {
            refreshSeed = state.feedRefreshSeed
        }
        let session = authSessionVersion, epoch = contentPageEpoch, requestID = UUID()
        state.requestID = requestID
        state.error = nil
        contentPages[query.key] = state
        defer {
            if contentPages[query.key]?.requestID == requestID { contentPages[query.key]?.requestID = nil }
        }
        do {
            let page = try await backendClient.contentPage(query, cursor: reset ? nil : state.nextCursor, token: backendToken, refreshSeed: refreshSeed)
            guard isCurrentSession(session), contentPageEpoch == epoch, contentPages[query.key]?.requestID == requestID else { return }
            mergeContentPage(page)
            let ids: [String]
            if query.isThreadPage { ids = page.messageThreads?.map(\.id) ?? [] }
            else if query.isMessagePage { ids = page.thread?.messages.map(\.id) ?? [] }
            else if query.isUserPage { ids = page.users?.map(\.id) ?? [] }
            else if query.isCollectionPage { ids = page.collections?.map(\.id) ?? [] }
            else if query.isCommentPage { ids = page.comments?.map(\.id) ?? [] }
            else { ids = page.posts?.map(\.id) ?? [] }
            if reset { state.ids = ids } else { let known = Set(state.ids); state.ids += ids.filter { !known.contains($0) } }
            state.isLoaded = true
            state.hasMore = page.hasMore ?? false
            state.nextCursor = page.nextCursor
            state.feedRefreshSeed = refreshSeed
            state.requestID = nil
            state.isOfflineSnapshot = false
            contentPages[query.key] = state
            isShowingOfflineFeed = false
            if query.path == "/feed" {
                persistOfflineFeedSnapshot()
                let warmPosts = Array(pagePosts(query).prefix(OfflineFeedCache.maximumPostsPerPage))
                if reset { prefetchedFeedPostIDs.subtract(warmPosts.map(\.id)) }
                prefetchFeedDetailsIfNeeded(for: warmPosts[...])
                prefetchFeedAssets(for: warmPosts)
            }
        } catch {
            guard isCurrentSession(session), contentPageEpoch == epoch, contentPages[query.key]?.requestID == requestID else { return }
            if contentPages[query.key]?.isOfflineSnapshot == true {
                contentPages[query.key]?.error = nil
                isShowingOfflineFeed = true
            } else {
                contentPages[query.key]?.error = error.localizedDescription
            }
        }
    }

    func mergeContentPage(_ page: BackendContentPage) {
        mergeUnreadSnapshot(page.unreadMessageCount, cursor: page.unreadCursor)
        mergeChangedMessageThreads(from: page.messageThreads?.map { $0.localThread() } ?? page.thread.map { [$0.localThread()] } ?? [])
        mergeUsers(page.users?.map { $0.localUser() } ?? [])
        mergePosts(page.posts?.map { $0.localPost() } ?? page.post.map { [$0.localPost()] } ?? [])
        mergeCollections(page.collections?.map { $0.localCollection() } ?? [])
        mergeComments(page.comments?.map { $0.localComment() } ?? [])
    }

    func loadPostDetail(_ id: String) async {
        let cachedComments = pageState(ContentQuery.comments(id))
        if isShowingOfflineFeed, cachedComments.isOfflineSnapshot { return }
        guard isBackendEnabled, postDetailRequests[id] == nil else { return }
        let session = authSessionVersion, requestID = UUID()
        postDetailRequests[id] = requestID
        defer { if postDetailRequests[id] == requestID { postDetailRequests[id] = nil } }
        do {
            let page = try await backendClient.postDetail(id, token: backendToken)
            guard isCurrentSession(session), postDetailRequests[id] == requestID else { return }
            mergeContentPage(page)
            var state = ContentPageState()
            state.ids = page.comments?.map(\.id) ?? []
            state.hasMore = page.commentsHasMore ?? false
            state.nextCursor = page.commentsNextCursor
            state.isLoaded = true
            contentPages[ContentQuery.comments(id).key] = state
            postDetailErrors[id] = nil
            persistOfflineFeedSnapshot()
        } catch {
            guard isCurrentSession(session), postDetailRequests[id] == requestID else { return }
            postDetailErrors[id] = error.localizedDescription
            if (error as NSError).domain == "AliyunBackendClient", (error as NSError).code == 404 {
                posts.removeAll { $0.id == id }
            }
        }
    }

    func contentQuery(from key: String) -> ContentQuery {
        guard let separator = key.firstIndex(of: "?") else { return ContentQuery(path: key) }
        let path = String(key[..<separator])
        let query = String(key[key.index(after: separator)...])
        var parameters: [String: String] = [:]
        URLComponents(string: "https://offline.local/?\(query)")?.queryItems?.forEach { item in
            if let value = item.value { parameters[item.name] = value }
        }
        return ContentQuery(path: path, parameters: parameters)
    }

    func persistOfflineFeedSnapshot() {
        guard persistsData, isLoggedIn, currentUserID != Self.demoUserID else { return }
        let homeKeys = contentPages.keys.filter { $0.hasPrefix("/feed?") }.sorted { lhs, rhs in
            // Keep the default tab's personalized posts first, then use any
            // remaining slots for the second home tab. The total is always 10.
            let lhsDefault = lhs.contains("groupType=followGroup")
            let rhsDefault = rhs.contains("groupType=followGroup")
            return lhsDefault != rhsDefault ? lhsDefault : lhs < rhs
        }
        var remaining = OfflineFeedCache.maximumPostsPerPage
        var pages: [OfflineFeedPage] = []
        for key in homeKeys where remaining > 0 {
            guard let state = contentPages[key], state.isLoaded else { continue }
            let ids = Array(state.ids.prefix(remaining))
            guard !ids.isEmpty else { continue }
            pages.append(OfflineFeedPage(key: key, ids: ids, nextCursor: state.nextCursor, hasMore: state.hasMore))
            remaining -= ids.count
        }
        guard !pages.isEmpty else { return }
        let postIDs = Set(pages.flatMap(\.ids))
        let commentPages = contentPages.keys.filter { $0.hasPrefix("/posts/") && $0.contains("/comments?") }.compactMap { key -> OfflineFeedPage? in
            let components = key.split(separator: "/")
            guard components.count >= 3, postIDs.contains(String(components[1])),
                  let state = contentPages[key], state.isLoaded else { return nil }
            return OfflineFeedPage(key: key, ids: Array(state.ids.prefix(20)), nextCursor: state.nextCursor, hasMore: state.hasMore)
        }
        pages.append(contentsOf: commentPages)
        let commentPostIDs = Set(commentPages.compactMap { page -> String? in
            let components = page.key.split(separator: "/")
            guard components.count >= 3 else { return nil }
            return String(components[1])
        })
        let allPostIDs = postIDs.union(commentPostIDs)
        let hiddenAuthorIDs = blockedUserIDs.union(blockedByUserIDs)
        let blockedPosts = posts.filter { allPostIDs.contains($0.id) && hiddenAuthorIDs.contains($0.authorID) }
        let blockedURLs = blockedPosts.flatMap { $0.previewRemoteImageURLs + $0.remoteImageURLs }.map(RemoteAssetRequest.canonicalURLString)
        if !blockedURLs.isEmpty { RemoteImageCache.shared.remove(urls: blockedURLs, accountID: currentUserID) }
        let snapshotPosts = posts.filter { allPostIDs.contains($0.id) && !hiddenAuthorIDs.contains($0.authorID) }
        let authorIDs = Set(snapshotPosts.map { $0.authorID })
        let collectionIDs = Set(snapshotPosts.compactMap { $0.collectionID })
        let snapshotPostIDs = Set(snapshotPosts.map { $0.id })
        let snapshotComments = comments.filter { snapshotPostIDs.contains($0.postID) }
        let commentAuthorIDs = Set(snapshotComments.map { $0.authorID })
        let snapshotUsers = users.filter { authorIDs.contains($0.id) || commentAuthorIDs.contains($0.id) || $0.id == currentUserID }
        let snapshotCollections = collections.filter { collectionIDs.contains($0.id) }
        OfflineFeedCache.shared.save(OfflineFeedSnapshot(accountID: currentUserID, savedAt: Date(), pages: pages,
                                                          users: snapshotUsers, posts: snapshotPosts,
                                                          collections: snapshotCollections, comments: snapshotComments))
    }

    private func prefetchFeedDetailsIfNeeded(for feedPosts: ArraySlice<GroupBuyPost>) {
        let candidates = feedPosts.filter { !prefetchedFeedPostIDs.contains($0.id) }
        guard !candidates.isEmpty else { return }
        prefetchedFeedPostIDs.formUnion(candidates.map(\.id))
        Task { @MainActor [weak self] in
            guard let self else { return }
            await withTaskGroup(of: Void.self) { group in
                for chunkStart in stride(from: 0, to: candidates.count, by: 4) {
                    let chunk = Array(candidates[chunkStart..<min(chunkStart + 4, candidates.count)])
                    group.addTask {
                        for post in chunk {
                            guard !Task.isCancelled else { return }
                            await self.loadPostDetail(post.id)
                        }
                    }
                }
            }
        }
    }

    func prefetchFeedAssets(for feedPosts: [GroupBuyPost]) {
        guard isBackendEnabled else { return }
        let posts = feedPosts.prefix(OfflineFeedCache.maximumPostsPerPage)
        let urls = Array(Set(posts.flatMap { post in
            post.previewRemoteImageURLs + post.remoteImageURLs +
            (users.first { $0.id == post.authorID }.map { [$0.avatarURL, $0.backgroundURL] } ?? [])
        }.filter { !$0.isEmpty }.map(RemoteAssetRequest.canonicalURLString)))
        let token = backendToken, accountID = currentUserID
        RemoteImageCache.shared.register(urls, accountID: accountID)
        Task.detached(priority: .utility) {
            await withTaskGroup(of: Void.self) { group in
                for chunkStart in stride(from: 0, to: urls.count, by: 4) {
                    let chunk = Array(urls[chunkStart..<min(chunkStart + 4, urls.count)])
                    group.addTask {
                        for url in chunk {
                            guard !Task.isCancelled else { return }
                            _ = try? await RemoteAssetRequest.data(urlString: url, token: token, accountID: accountID)
                        }
                    }
                }
            }
        }
    }
}

struct ContentPageFooter: View {
    @EnvironmentObject private var store: MockAppStore
    let query: ContentQuery
    var loadMore: (() async -> Void)? = nil

    var body: some View {
        let state = store.pageState(query)
        Group {
            if !store.isBackendEnabled { EmptyView() }
            else if state.requestID != nil { ProgressView().padding() }
            else if let error = state.error {
                VStack(spacing: 8) {
                    Text(error).font(.footnote).foregroundStyle(Theme.subtext)
                    Button("重试加载") { Task { await load(reset: !state.isLoaded) } }
                }.padding()
            } else if state.hasMore {
                Button(state.isLoaded ? "加载更多" : "加载内容") { Task { await load() } }.padding()
            } else if state.ids.isEmpty {
                Text("暂无内容").font(.subheadline).foregroundStyle(Theme.muted).padding()
            }
        }
        .frame(maxWidth: .infinity)
        .task(id: "\(store.authSessionVersion)-\(store.contentPageEpoch)-\(query.key)") {
            if !store.pageState(query).isLoaded { await store.loadContentPage(query) }
        }
    }

    private func load(reset: Bool = false) async {
        if !reset, let loadMore { await loadMore() }
        else { await store.loadContentPage(query, reset: reset) }
    }
}
