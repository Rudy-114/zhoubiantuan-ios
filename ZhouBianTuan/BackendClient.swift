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
    let sharedPostID: String?
    let sharedProfileUserID: String?

    func localMessage() -> DirectMessage {
        DirectMessage(
            id: id,
            senderID: senderID,
            body: body,
            createdAt: BackendDateParser.date(from: createdAt),
            sharedPostID: sharedPostID,
            sharedProfileUserID: sharedProfileUserID
        )
    }
}

struct BackendMessageThreadResponse: Decodable {
    let thread: BackendMessageThread
}

struct UploadTarget: Decodable {
    let objectKey: String
    let uploadUrl: String
}

final class AliyunBackendClient {
    static let baseURLDefaultsKey = "zhoubiantuan.backendBaseURL"
    static let defaultBaseURL = "https://api.zhoubiantuanmail.top/api"
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
        return UserDefaults.standard.string(forKey: baseURLDefaultsKey) ?? defaultBaseURL
        #else
        return defaultBaseURL
        #endif
    }

    init(baseURLString: String = AliyunBackendClient.configuredBaseURL, session: URLSession = AliyunBackendClient.defaultSession) {
        self.baseURL = URL(string: baseURLString) ?? URL(string: Self.defaultBaseURL)!
        self.session = session
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
            "groupInfo": collection.groupInfo,
            "deadline": BackendDateParserString.string(from: collection.deadline),
            "defaultNote": collection.defaultNote
        ])
    }

    func deleteCollection(token: String, collectionID: String) async throws {
        try await emptyRequest("/collections/\(collectionID)", method: "DELETE", token: token)
    }

    @discardableResult
    func createPost(token: String, post: GroupBuyPost, imageObjectKeys: [String]) async throws -> BackendPostMutationResponse {
        let roles = post.unsoldRoles.map { ["id": $0.id, "name": $0.name, "quantity": $0.quantity, "priceAdjustment": $0.priceAdjustment] as [String: Any] }
        return try await request("/posts", method: "POST", token: token, body: [
            "id": post.id,
            "title": post.title,
            "imageNames": post.imageNames,
            "imageObjectKeys": imageObjectKeys,
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
            "sharedPostID": message.sharedPostID ?? "",
            "sharedProfileUserID": message.sharedProfileUserID ?? ""
        ])
    }

    func markDirectMessageThreadRead(token: String, threadID: String) async throws {
        try await emptyRequest("/messages/threads/\(threadID)/read", method: "POST", token: token)
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
            "detail": "来自 iOS 内测版举报"
        ])
    }

    func uploadPostImages(token: String, images: [Data]) async throws -> [String] {
        try await uploadImages(token: token, images: images, kind: "post", filenamePrefix: "post")
    }

    func uploadProfileImage(token: String, data: Data, kind: String) async throws -> String {
        try await uploadImages(token: token, images: [data], kind: kind, filenamePrefix: kind).first ?? ""
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

    private func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            let errorMessage = (try? JSONDecoder().decode(APIError.self, from: data).error) ?? "请求失败"
            throw NSError(domain: "AliyunBackendClient", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: errorMessage])
        }
    }

    private struct APIError: Decodable {
        let error: String
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
