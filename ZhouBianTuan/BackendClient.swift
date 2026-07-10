import Foundation

enum BackendDateParser {
    static func date(from value: String?) -> Date {
        guard let value else { return Date() }
        if let date = fractionalFormatter.date(from: value) {
            return date
        }
        if let date = plainFormatter.date(from: value) {
            return date
        }
        return Date()
    }

    private static let fractionalFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let plainFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}

struct BackendPayload: Decodable {
    var token: String?
    var syncCursor: String?
    var currentUser: BackendUser?
    var users: [BackendUser]?
    var posts: [BackendPost]?
    var collections: [BackendCollection]?
    var comments: [BackendComment]?
    var messageThreads: [BackendMessageThread]?
    var reports: [BackendReport]?
    var likedPostIDs: [String]?
    var favoritePostIDs: [String]?
    var followedUserIDs: [String]?
    var followingByUserID: [String: [String]]?
    var blockedUserIDs: [String]?
    var blockedByUserIDs: [String]?
}

enum BackendAssetURLMapper {
    static func normalized(_ urlString: String?) -> String {
        guard let urlString, !urlString.isEmpty else { return "" }
        return normalized(urlString)
    }

    static func normalized(_ urlString: String) -> String {
        #if DEBUG
        guard
            let defaultBase = URLComponents(string: AliyunBackendClient.defaultBaseURL),
            let currentBase = URLComponents(string: AliyunBackendClient.currentBaseURLString),
            defaultBase.host != currentBase.host || defaultBase.scheme != currentBase.scheme || defaultBase.port != currentBase.port,
            var incoming = URLComponents(string: urlString),
            incoming.host == defaultBase.host,
            incoming.scheme == defaultBase.scheme
        else {
            return urlString
        }

        let defaultPath = defaultBase.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let currentPath = currentBase.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let incomingPath = incoming.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard incomingPath == defaultPath || incomingPath.hasPrefix("\(defaultPath)/") else {
            return urlString
        }

        let suffix = incomingPath.dropFirst(defaultPath.count).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        incoming.scheme = currentBase.scheme
        incoming.host = currentBase.host
        incoming.port = currentBase.port
        incoming.path = "/" + ([currentPath, suffix].filter { !$0.isEmpty }.joined(separator: "/"))
        return incoming.url?.absoluteString ?? urlString
        #else
        return urlString
        #endif
    }

    static func normalized(_ urlStrings: [String]) -> [String] {
        urlStrings.map(normalized(_:))
    }
}

struct BackendUser: Decodable {
    let id: String
    let email: String?
    let nickname: String
    let bio: String
    let followingCount: Int
    let followersCount: Int
    let postCount: Int
    let isRestricted: Bool
    let canShowContact: Bool
    let avatarSymbol: String
    let avatarTint: String
    let redBookID: String
    let gender: String
    let birthday: String
    let region: String
    let backgroundImageName: String
    let avatarURL: String?
    let backgroundURL: String?
    let phoneNumber: String?
    let lastNicknameChangedAt: String?
    let moderationStatus: String?
    let moderationReason: String?
    let reviewID: String?

    func localUser() -> User {
        User(
            id: id,
            email: email ?? "",
            nickname: nickname,
            bio: bio,
            followingCount: followingCount,
            followersCount: followersCount,
            postCount: postCount,
            isRestricted: isRestricted,
            canShowContact: canShowContact,
            avatarSymbol: avatarSymbol,
            avatarTint: ColorToken(rawValue: avatarTint) ?? .rose,
            redBookID: redBookID,
            gender: gender,
            birthday: birthday,
            region: region,
            backgroundImageName: backgroundImageName,
            avatarURL: BackendAssetURLMapper.normalized(avatarURL),
            backgroundURL: BackendAssetURLMapper.normalized(backgroundURL),
            lastNicknameChangedAt: lastNicknameChangedAt.map(BackendDateParser.date(from:)),
            moderationStatus: moderationStatus.map(ContentStatus.backendValue(_:)),
            moderationReason: moderationReason ?? "",
            reviewID: reviewID ?? "",
            phoneNumber: phoneNumber ?? ""
        )
    }
}

struct BackendBlockedUsersResponse: Decodable {
    let blockedUsers: [BackendUser]?
}

struct BackendRole: Decodable {
    let id: String?
    let name: String
    let quantity: Int
    let priceAdjustment: Double?

    func localRole() -> UnsoldRole {
        UnsoldRole(id: id ?? "role-\(UUID().uuidString)", name: name, quantity: quantity, priceAdjustment: priceAdjustment ?? 0)
    }
}

struct BackendPost: Decodable {
    let id: String
    let title: String
    let imageNames: [String]
    let remoteImageURLs: [String]?
    let imageObjectKeys: [String]?
    let previewRemoteImageURLs: [String]?
    let previewImageObjectKeys: [String]?
    let authorID: String
    let groupType: String
    let collectionID: String?
    let categoryTags: [String]
    let fandomTags: [String]
    let price: String
    let deposit: String
    let deadline: String
    let condition: String
    let isFormed: Bool
    let description: String
    let wechat: String
    let qq: String
    let groupNumber: String?
    let groupInfo: String
    let externalLink: String
    let createdAt: String
    let likedCount: Int
    let favoriteCount: Int
    let commentCount: Int
    let reportCount: Int
    let status: String
    let moderationReason: String?
    let reviewID: String?
    let imageAspect: Double
    let pingguAveragePrice: String
    let pingguNote: String
    let unsoldRoles: [BackendRole]

    func localPost() -> GroupBuyPost {
        GroupBuyPost(
            id: id,
            title: title,
            imageNames: imageNames,
            remoteImageURLs: BackendAssetURLMapper.normalized(remoteImageURLs ?? []),
            imageObjectKeys: imageObjectKeys ?? [],
            previewRemoteImageURLs: BackendAssetURLMapper.normalized(previewRemoteImageURLs ?? []),
            previewImageObjectKeys: previewImageObjectKeys ?? [],
            authorID: authorID,
            groupType: GroupBuyType.backendValue(groupType),
            collectionID: collectionID,
            categoryTags: categoryTags,
            fandomTags: fandomTags,
            price: price,
            deposit: deposit,
            deadline: BackendDateParser.date(from: deadline),
            condition: condition,
            isFormed: isFormed,
            description: description,
            wechat: wechat,
            qq: qq,
            groupNumber: groupNumber ?? "",
            groupInfo: groupInfo,
            externalLink: externalLink,
            createdAt: BackendDateParser.date(from: createdAt),
            likedCount: likedCount,
            favoriteCount: favoriteCount,
            commentCount: commentCount,
            reportCount: reportCount,
            status: ContentStatus.backendValue(status),
            moderationReason: moderationReason ?? "",
            reviewID: reviewID ?? "",
            imageAspect: imageAspect,
            pingguAveragePrice: pingguAveragePrice,
            pingguNote: pingguNote,
            unsoldRoles: unsoldRoles.map { $0.localRole() }
        )
    }
}

struct BackendCollection: Decodable {
    let id: String
    let ownerID: String
    let name: String
    let contactWechat: String
    let contactQQ: String
    let contactGroupNumber: String?
    let groupInfo: String
    let deadline: String
    let defaultNote: String
    let postIDs: [String]
    let createdAt: String
    let status: String?

    func localCollection() -> GroupCollection {
        GroupCollection(
            id: id,
            ownerID: ownerID,
            name: name,
            contactWechat: contactWechat,
            contactQQ: contactQQ,
            contactGroupNumber: contactGroupNumber ?? "",
            groupInfo: groupInfo,
            deadline: BackendDateParser.date(from: deadline),
            defaultNote: defaultNote,
            postIDs: postIDs,
            createdAt: BackendDateParser.date(from: createdAt),
            status: ContentStatus.backendValue(status ?? "active")
        )
    }
}

struct BackendComment: Decodable {
    let id: String
    let body: String
    let authorID: String
    let postID: String
    let replyToID: String?
    let createdAt: String
    let status: String
    let moderationReason: String?
    let reviewID: String?

    func localComment() -> Comment {
        Comment(id: id, body: body, authorID: authorID, postID: postID, replyToID: replyToID, createdAt: BackendDateParser.date(from: createdAt), status: ContentStatus.backendValue(status), moderationReason: moderationReason ?? "", reviewID: reviewID ?? "")
    }
}

struct BackendReportTarget: Decodable {
    let type: String
    let id: String
}

struct BackendReport: Decodable {
    let id: String
    let target: BackendReportTarget
    let reason: String
    let detail: String
    let reporterID: String
    let status: String
    let adminResult: String?
    let handledAt: String?

    func localReport() -> Report {
        let localTarget: ReportTarget = target.type == "comment" ? .comment(target.id) : .post(target.id)
        return Report(id: id, target: localTarget, reason: reason, detail: detail, reporterID: reporterID, status: ReportStatus.backendValue(status), adminResult: adminResult, handledAt: handledAt.map(BackendDateParser.date(from:)))
    }
}

struct BackendMessageThread: Decodable {
    let id: String
    let buyerUserID: String
    let publisherUserID: String
    let relatedPostID: String?
    let messages: [BackendDirectMessage]
    let unreadCount: Int
    let updatedAt: String

    func localThread() -> MessageThread {
        MessageThread(
            id: id,
            buyerUserID: buyerUserID,
            publisherUserID: publisherUserID,
            relatedPostID: relatedPostID,
            messages: messages.map { $0.localMessage() },
            unreadCount: unreadCount,
            updatedAt: BackendDateParser.date(from: updatedAt)
        )
    }
}

struct BackendDirectMessage: Decodable {
    let id: String
    let senderID: String
    let body: String
    let createdAt: String
    let imageURL: String?
    let isRevoked: Bool?
    let isDeletedForMe: Bool?
    let sharedPostID: String?
    let sharedProfileUserID: String?

    func localMessage() -> DirectMessage {
        DirectMessage(
            id: id,
            senderID: senderID,
            body: body,
            createdAt: BackendDateParser.date(from: createdAt),
            remoteImageURL: BackendAssetURLMapper.normalized(imageURL ?? ""),
            isRevoked: isRevoked ?? false,
            isDeletedForMe: isDeletedForMe ?? false,
            sharedPostID: sharedPostID,
            sharedProfileUserID: sharedProfileUserID
        )
    }
}

struct BackendMessageThreadResponse: Decodable {
    let thread: BackendMessageThread
}

struct BackendCollectionMutationResponse: Decodable {
    let collection: BackendCollection
}

struct BackendSyncPayload: Decodable {
    let nextCursor: String
    let hasMore: Bool
    let events: [BackendSyncEvent]
    let users: [BackendUser]?
    let posts: [BackendPost]?
    let collections: [BackendCollection]?
    let comments: [BackendComment]?
    let messageThreads: [BackendMessageThread]
    let unreadMessageCount: Int
    let likedPostIDs: [String]?
    let favoritePostIDs: [String]?
    let followedUserIDs: [String]?
    let followingByUserID: [String: [String]]?
    let blockedUserIDs: [String]?
    let blockedByUserIDs: [String]?
}

struct BackendSyncEvent: Decodable {
    let id: String
    let userID: String?
    let eventType: String
    let entityType: String
    let entityID: String
    let threadID: String?
    let createdAt: String
}

struct BackendRealtimeEvent: Decodable {
    let type: String
    let cursor: String?
    let eventType: String?
    let threadID: String?
}

enum SyncCursorStore {
    private static let prefix = "zhoubiantuan.syncCursor"

    static func cursor(for userID: String) -> String? {
        UserDefaults.standard.string(forKey: key(for: userID))
    }

    static func set(_ cursor: String, for userID: String) {
        UserDefaults.standard.set(cursor, forKey: key(for: userID))
    }

    static func remove(for userID: String) {
        UserDefaults.standard.removeObject(forKey: key(for: userID))
    }

    private static func key(for userID: String) -> String {
        "\(prefix).\(userID)"
    }
}

struct UploadTarget: Decodable {
    let objectKey: String
    let uploadUrl: String
}

final class AliyunBackendClient {
    static let baseURLDefaultsKey = "zhoubiantuan.backendBaseURL"
    static let defaultBaseURL = "https://api.zhoubiantuanmail.top/api"
    #if DEBUG
    static let debugDefaultBaseURL = "http://127.0.0.1:18080/api"
    #endif
    static var currentBaseURLString: String { configuredBaseURL }

    private let baseURL: URL
    private let session: URLSession
    private static let defaultSession: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 18
        configuration.timeoutIntervalForResource = 55
        configuration.waitsForConnectivity = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration)
    }()

    private static var configuredBaseURL: String {
        #if DEBUG
        return UserDefaults.standard.string(forKey: baseURLDefaultsKey) ?? debugDefaultBaseURL
        #else
        return defaultBaseURL
        #endif
    }

    init(baseURLString: String = AliyunBackendClient.configuredBaseURL, session: URLSession = AliyunBackendClient.defaultSession) {
        self.baseURL = URL(string: baseURLString) ?? URL(string: Self.defaultBaseURL)!
        self.session = session
    }

    var webSocketURL: URL {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            return baseURL
        }
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        let basePath = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.path = "/" + ([basePath, "ws"].filter { !$0.isEmpty }.joined(separator: "/"))
        return components.url ?? baseURL
    }

    func register(email: String, password: String, nickname: String) async throws -> BackendPayload {
        try await request("/auth/register", method: "POST", body: [
            "email": email,
            "password": password,
            "nickname": nickname
        ])
    }

    func sendEmailCode(email: String, purpose: String) async throws {
        let _: EmptyResponse = try await request("/auth/email/send-code", method: "POST", body: [
            "email": email,
            "purpose": purpose
        ])
    }

    func registerWithEmailCode(email: String, password: String, nickname: String, code: String) async throws -> BackendPayload {
        try await request("/auth/email/register", method: "POST", body: [
            "email": email,
            "password": password,
            "nickname": nickname,
            "code": code
        ])
    }

    func login(email: String, password: String) async throws -> BackendPayload {
        try await request("/auth/email/login", method: "POST", body: [
            "email": email,
            "password": password
        ])
    }

    func loginWithEmailCode(email: String, code: String) async throws -> BackendPayload {
        try await request("/auth/email/login", method: "POST", body: [
            "email": email,
            "code": code
        ])
    }

    func bootstrap(token: String) async throws -> BackendPayload {
        try await request("/bootstrap", token: token)
    }

    func feed(limit: Int = 40) async throws -> BackendPayload {
        try await request("/feed?limit=\(limit)")
    }

    func sync(token: String, cursor: String, limit: Int = 100) async throws -> BackendSyncPayload {
        let encodedCursor = cursor.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "0"
        return try await request("/sync?cursor=\(encodedCursor)&limit=\(limit)", token: token)
    }

    @discardableResult
    func updateProfile(token: String, user: User, avatarObjectKey: String? = nil, backgroundObjectKey: String? = nil) async throws -> BackendProfileUpdateResponse {
        var body: [String: Any] = [
            "nickname": user.nickname,
            "bio": user.bio,
            "redBookID": user.redBookID,
            "gender": user.gender,
            "birthday": user.birthday,
            "region": user.region,
            "avatarSymbol": user.avatarSymbol,
            "avatarTint": user.avatarTint.rawValue,
            "backgroundImageName": user.backgroundImageName
        ]
        if let avatarObjectKey {
            body["avatarObjectKey"] = avatarObjectKey
        }
        if let backgroundObjectKey {
            body["backgroundObjectKey"] = backgroundObjectKey
        }
        return try await request("/me", method: "PATCH", token: token, body: body)
    }

    func createCollection(token: String, collection: GroupCollection) async throws {
        let _: EmptyResponse = try await request("/collections", method: "POST", token: token, body: [
            "id": collection.id,
            "name": collection.name,
            "wechat": collection.contactWechat,
            "qq": collection.contactQQ,
            "groupNumber": collection.contactGroupNumber,
            "groupInfo": collection.groupInfo,
            "deadline": BackendDateParserString.string(from: collection.deadline),
            "defaultNote": collection.defaultNote
        ])
    }

    @discardableResult
    func updateCollection(token: String, collection: GroupCollection) async throws -> BackendCollectionMutationResponse {
        try await request("/collections/\(collection.id)", method: "PATCH", token: token, body: [
            "name": collection.name,
            "wechat": collection.contactWechat,
            "qq": collection.contactQQ,
            "groupNumber": collection.contactGroupNumber,
            "groupInfo": collection.groupInfo,
            "deadline": BackendDateParserString.string(from: collection.deadline),
            "defaultNote": collection.defaultNote
        ])
    }

    func deleteCollection(token: String, collectionID: String) async throws {
        try await emptyRequest("/collections/\(collectionID)", method: "DELETE", token: token)
    }

    @discardableResult
    func createPost(token: String, post: GroupBuyPost, imageObjectKeys: [String], previewImageObjectKeys: [String] = []) async throws -> BackendPostMutationResponse {
        let roles = post.unsoldRoles.map { ["id": $0.id, "name": $0.name, "quantity": $0.quantity, "priceAdjustment": $0.priceAdjustment] as [String: Any] }
        return try await request("/posts", method: "POST", token: token, body: [
            "id": post.id,
            "title": post.title,
            "imageNames": post.imageNames,
            "imageObjectKeys": imageObjectKeys,
            "previewImageObjectKeys": previewImageObjectKeys,
            "groupType": post.groupType.backendValue,
            "collectionID": post.collectionID ?? "",
            "categoryTags": post.categoryTags,
            "fandomTags": post.fandomTags,
            "price": post.price,
            "deposit": post.deposit,
            "deadline": BackendDateParserString.string(from: post.deadline),
            "condition": post.condition,
            "isFormed": post.isFormed,
            "description": post.description,
            "wechat": post.wechat,
            "qq": post.qq,
            "groupNumber": post.groupNumber,
            "groupInfo": post.groupInfo,
            "externalLink": post.externalLink,
            "imageAspect": post.imageAspect,
            "pingguAveragePrice": post.pingguAveragePrice,
            "pingguNote": post.pingguNote,
            "unsoldRoles": roles
        ])
    }

    func deletePost(token: String, postID: String) async throws {
        try await emptyRequest("/posts/\(postID)", method: "DELETE", token: token)
    }

    func setPostFlag(token: String, postID: String, flag: String, enabled: Bool) async throws {
        try await emptyRequest("/posts/\(postID)/\(flag)", method: enabled ? "POST" : "DELETE", token: token)
    }

    func setFollow(token: String, userID: String, enabled: Bool) async throws {
        try await emptyRequest("/users/\(userID)/follow", method: enabled ? "POST" : "DELETE", token: token)
    }

    @discardableResult
    func sendDirectMessage(token: String, thread: MessageThread, recipientUserID: String, message: DirectMessage) async throws -> BackendMessageThreadResponse {
        try await request("/messages/threads/\(thread.id)/messages", method: "POST", token: token, body: [
            "recipientUserID": recipientUserID,
            "relatedPostID": thread.relatedPostID ?? "",
            "messageID": message.id,
            "body": message.body,
            "imageObjectKey": message.imageObjectKey,
            "sharedPostID": message.sharedPostID ?? "",
            "sharedProfileUserID": message.sharedProfileUserID ?? ""
        ])
    }

    func markDirectMessageThreadRead(token: String, threadID: String) async throws {
        try await emptyRequest("/messages/threads/\(threadID)/read", method: "POST", token: token)
    }

    @discardableResult
    func deleteDirectMessage(token: String, threadID: String, messageID: String) async throws -> BackendMessageThreadResponse {
        try await request("/messages/threads/\(threadID)/messages/\(messageID)", method: "DELETE", token: token)
    }

    @discardableResult
    func revokeDirectMessage(token: String, threadID: String, messageID: String) async throws -> BackendMessageThreadResponse {
        try await request("/messages/threads/\(threadID)/messages/\(messageID)/revoke", method: "POST", token: token)
    }

    @discardableResult
    func addComment(token: String, postID: String, body: String, replyToID: String? = nil) async throws -> BackendCommentMutationResponse {
        return try await request("/posts/\(postID)/comments", method: "POST", token: token, body: [
            "body": body,
            "replyToID": replyToID ?? ""
        ])
    }

    func moderationReviews(token: String, status: String = "review") async throws -> [ModerationReview] {
        let payload: BackendModerationReviewsResponse = try await request("/moderation/reviews?status=\(status)", token: token)
        return payload.reviews.map { $0.localReview() }
    }

    @discardableResult
    func decideModerationReview(token: String, reviewID: String, decision: String, reason: String = "") async throws -> ModerationReview {
        let payload: BackendModerationReviewResponse = try await request("/moderation/reviews/\(reviewID)/decision", method: "POST", token: token, body: [
            "decision": decision,
            "reason": reason
        ])
        return payload.review.localReview()
    }

    func deleteComment(token: String, commentID: String) async throws {
        try await emptyRequest("/comments/\(commentID)", method: "DELETE", token: token)
    }

    func reportPost(token: String, postID: String, reason: String) async throws {
        let _: EmptyResponse = try await request("/reports", method: "POST", token: token, body: [
            "targetType": "post",
            "targetID": postID,
            "reason": reason,
            "detail": "来自 iOS 用户举报"
        ])
    }

    func deleteAccount(token: String) async throws {
        try await emptyRequest("/me", method: "DELETE", token: token)
    }

    func blockUser(token: String, userID: String) async throws {
        try await emptyRequest("/users/\(userID)/block", method: "POST", token: token)
    }

    func unblockUser(token: String, userID: String) async throws {
        try await emptyRequest("/users/\(userID)/block", method: "DELETE", token: token)
    }

    func blockedUsers(token: String) async throws -> [User] {
        let payload: BackendBlockedUsersResponse = try await request("/me/blocked-users", token: token)
        return (payload.blockedUsers ?? []).map { $0.localUser() }
    }

    func uploadPostImages(token: String, images: [Data]) async throws -> [String] {
        try await uploadImages(token: token, images: images, kind: "post", filenamePrefix: "post")
    }

    func uploadPostPreviewImages(token: String, images: [Data]) async throws -> [String] {
        let previewImages = images.map {
            ImageDataNormalizer.jpegData(from: $0, maxSide: 520, compressionQuality: 0.42)
        }
        return try await uploadImages(token: token, images: previewImages, kind: "post", filenamePrefix: "post-preview")
    }

    func uploadProfileImage(token: String, data: Data, kind: String) async throws -> String {
        try await uploadImages(token: token, images: [data], kind: kind, filenamePrefix: kind).first ?? ""
    }

    func uploadMessageImage(token: String, data: Data) async throws -> String {
        try await uploadImages(token: token, images: [data], kind: "message", filenamePrefix: "message").first ?? ""
    }

    private func uploadImages(token: String, images: [Data], kind: String, filenamePrefix: String) async throws -> [String] {
        var keys: [String] = []
        for (index, data) in images.enumerated() {
            let target: UploadTarget = try await request("/uploads/presign", method: "POST", token: token, body: [
                "kind": kind,
                "filename": "\(filenamePrefix)-\(index).jpg",
                "contentType": "image/jpeg"
            ])
            guard let uploadURL = URL(string: target.uploadUrl) else {
                throw NSError(domain: "AliyunBackendClient", code: -1000, userInfo: [NSLocalizedDescriptionKey: "上传地址无效"])
            }
            var request = URLRequest(url: uploadURL)
            request.httpMethod = "PUT"
            request.timeoutInterval = 45
            request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
            do {
                let (_, response) = try await session.upload(for: request, from: data)
                try validate(response: response, data: Data())
            } catch let error as URLError where error.code == .timedOut {
                throw NSError(domain: "AliyunBackendClient", code: error.errorCode, userInfo: [NSLocalizedDescriptionKey: "图片上传超时，请换个网络或稍后重试"])
            }
            keys.append(target.objectKey)
        }
        return keys
    }

    private func request<T: Decodable>(_ path: String, method: String = "GET", token: String? = nil, body: [String: Any]? = nil) async throws -> T {
        let trimmedPath = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let requestURL: URL
        if trimmedPath.contains("?") {
            requestURL = URL(string: "\(baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/\(trimmedPath)") ?? baseURL
        } else {
            requestURL = baseURL.appendingPathComponent(trimmedPath)
        }
        var request = URLRequest(url: requestURL)
        request.httpMethod = method
        request.timeoutInterval = 18
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        do {
            let (data, response) = try await session.data(for: request)
            try validate(response: response, data: data)
            if T.self == EmptyResponse.self {
                return EmptyResponse() as! T
            }
            return try JSONDecoder().decode(T.self, from: data)
        } catch let error as URLError where error.code == .timedOut {
            throw NSError(domain: "AliyunBackendClient", code: error.errorCode, userInfo: [NSLocalizedDescriptionKey: "网络请求超时，请稍后重试"])
        }
    }

    private func emptyRequest(_ path: String, method: String, token: String) async throws {
        let _: EmptyResponse = try await request(path, method: method, token: token)
    }

    static let errorCodeUserInfoKey = "AliyunBackendClientErrorCode"

    private func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            let apiError = try? JSONDecoder().decode(APIError.self, from: data)
            var userInfo: [String: Any] = [NSLocalizedDescriptionKey: apiError?.error ?? "请求失败"]
            if let code = apiError?.code {
                userInfo[Self.errorCodeUserInfoKey] = code
            }
            throw NSError(domain: "AliyunBackendClient", code: http.statusCode, userInfo: userInfo)
        }
    }

    private struct APIError: Decodable {
        let error: String
        let code: String?
    }
}

struct BackendDateParserString {
    static func string(from date: Date) -> String {
        formatter.string(from: date)
    }

    private static let formatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

struct EmptyResponse: Decodable {}

@MainActor
final class RealtimeConnection {
    private let backendClient: AliyunBackendClient
    private let session: URLSession
    private let onEvent: (BackendRealtimeEvent) async -> Void
    private let onStateChange: (Bool) -> Void
    private var webSocketTask: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var token: String?
    private var shouldReconnect = false
    private var reconnectAttempt = 0
    private var isConnected = false
    private var connectionState = RealtimeConnectionState()

    init(
        backendClient: AliyunBackendClient,
        session: URLSession = .shared,
        onEvent: @escaping (BackendRealtimeEvent) async -> Void,
        onStateChange: @escaping (Bool) -> Void
    ) {
        self.backendClient = backendClient
        self.session = session
        self.onEvent = onEvent
        self.onStateChange = onStateChange
    }

    func connect(token: String) {
        self.token = token
        shouldReconnect = true
        guard webSocketTask == nil else { return }
        open()
    }

    func disconnect() {
        shouldReconnect = false
        reconnectTask?.cancel()
        reconnectTask = nil
        receiveTask?.cancel()
        receiveTask = nil
        cancelCurrentTask(&webSocketTask, requestedTask: nil) {
            $0.cancel(with: .goingAway, reason: nil)
        }
        connectionState.disconnect()
        updateConnected(false)
    }

    private func open() {
        guard shouldReconnect, let token, webSocketTask == nil else { return }
        reconnectTask?.cancel()
        reconnectTask = nil

        var request = URLRequest(url: backendClient.webSocketURL)
        request.timeoutInterval = 15
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let task = session.webSocketTask(with: request)
        webSocketTask = task
        connectionState.beginOpening()
        task.resume()
        startReceiveLoop(for: task)
        task.sendPing { [weak self, weak task] error in
            Task { @MainActor [weak self, weak task] in
                guard let self, let task, self.webSocketTask === task else { return }
                if error != nil {
                    self.handleDisconnect(for: task)
                    return
                }
                self.connectionState.confirmOpen()
                self.updateConnected(true)
                self.reconnectAttempt = 0
            }
        }
    }

    private func startReceiveLoop(for task: URLSessionWebSocketTask) {
        receiveTask?.cancel()
        receiveTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    let message = try await task.receive()
                    await self?.handle(message, from: task)
                } catch {
                    self?.handleDisconnect(for: task)
                    return
                }
            }
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message, from task: URLSessionWebSocketTask) async {
        guard webSocketTask === task else { return }
        let data: Data?
        switch message {
        case .string(let string):
            data = string.data(using: .utf8)
        case .data(let incomingData):
            data = incomingData
        @unknown default:
            data = nil
        }
        guard let data,
              let event = try? JSONDecoder().decode(BackendRealtimeEvent.self, from: data) else { return }
        if !connectionState.isConnected {
            connectionState.confirmOpen()
            updateConnected(true)
        }
        reconnectAttempt = 0
        await onEvent(event)
    }

    private func handleDisconnect(for task: URLSessionWebSocketTask? = nil) {
        guard cancelCurrentTask(&webSocketTask, requestedTask: task, cancel: {
            $0.cancel(with: .goingAway, reason: nil)
        }) else { return }
        receiveTask?.cancel()
        receiveTask = nil
        connectionState.disconnect()
        updateConnected(false)
        scheduleReconnectIfNeeded()
    }

    private func scheduleReconnectIfNeeded() {
        guard shouldReconnect, reconnectTask == nil else { return }
        let delays: [UInt64] = [1, 2, 5, 10, 30]
        let delay = delays[min(reconnectAttempt, delays.count - 1)]
        reconnectAttempt += 1
        reconnectTask = Task { [weak self] in
            do {
                try await Task.sleep(nanoseconds: delay * 1_000_000_000)
            } catch {
                return
            }
            guard let self,
                  shouldOpenRealtimeConnection(
                    reconnectTaskIsCancelled: Task.isCancelled,
                    hasActiveWebSocketTask: self.webSocketTask != nil
                  )
            else { return }
            self.open()
        }
    }

    private func updateConnected(_ connected: Bool) {
        guard isConnected != connected else { return }
        isConnected = connected
        onStateChange(connected)
    }
}
