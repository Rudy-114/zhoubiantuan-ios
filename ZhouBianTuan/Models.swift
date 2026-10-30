import Foundation
import SwiftUI

struct User: Identifiable, Hashable, Codable {
    let id: String
    var email: String = ""
    var nickname: String
    var bio: String
    var followingCount: Int
    var followersCount: Int
    var postCount: Int
    var isRestricted: Bool
    var canShowContact: Bool
    var avatarSymbol: String
    var avatarTint: ColorToken
    var redBookID: String = ""
    var gender: String = ""
    var birthday: String = ""
    var region: String = ""
    var backgroundImageName: String = "merch_magazine"
    var avatarImageData: Data? = nil
    var backgroundImageData: Data? = nil
    var avatarURL: String = ""
    var backgroundURL: String = ""
    var lastNicknameChangedAt: Date? = nil
    var moderationStatus: ContentStatus? = nil
    var moderationReason: String = ""
    var reviewID: String = ""
    var phoneNumber: String = ""
    var password: String = ""
    var moderationRole: String = "user"
}

extension User {
    private enum CodingKeys: String, CodingKey {
        case id, email, nickname, bio, followingCount, followersCount, postCount
        case isRestricted, canShowContact, avatarSymbol, avatarTint, redBookID, gender
        case birthday, region, backgroundImageName, avatarURL, backgroundURL
        case lastNicknameChangedAt, moderationStatus, moderationReason, reviewID
        case phoneNumber, moderationRole
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        email = try container.decodeIfPresent(String.self, forKey: .email) ?? ""
        nickname = try container.decode(String.self, forKey: .nickname)
        bio = try container.decodeIfPresent(String.self, forKey: .bio) ?? ""
        followingCount = try container.decodeIfPresent(Int.self, forKey: .followingCount) ?? 0
        followersCount = try container.decodeIfPresent(Int.self, forKey: .followersCount) ?? 0
        postCount = try container.decodeIfPresent(Int.self, forKey: .postCount) ?? 0
        isRestricted = try container.decodeIfPresent(Bool.self, forKey: .isRestricted) ?? false
        canShowContact = try container.decodeIfPresent(Bool.self, forKey: .canShowContact) ?? false
        avatarSymbol = try container.decodeIfPresent(String.self, forKey: .avatarSymbol) ?? ""
        avatarTint = try container.decodeIfPresent(ColorToken.self, forKey: .avatarTint) ?? .rose
        redBookID = try container.decodeIfPresent(String.self, forKey: .redBookID) ?? ""
        gender = try container.decodeIfPresent(String.self, forKey: .gender) ?? ""
        birthday = try container.decodeIfPresent(String.self, forKey: .birthday) ?? ""
        region = try container.decodeIfPresent(String.self, forKey: .region) ?? ""
        backgroundImageName = try container.decodeIfPresent(String.self, forKey: .backgroundImageName) ?? "merch_magazine"
        avatarURL = try container.decodeIfPresent(String.self, forKey: .avatarURL) ?? ""
        backgroundURL = try container.decodeIfPresent(String.self, forKey: .backgroundURL) ?? ""
        lastNicknameChangedAt = try container.decodeIfPresent(Date.self, forKey: .lastNicknameChangedAt)
        moderationStatus = try container.decodeIfPresent(ContentStatus.self, forKey: .moderationStatus)
        moderationReason = try container.decodeIfPresent(String.self, forKey: .moderationReason) ?? ""
        reviewID = try container.decodeIfPresent(String.self, forKey: .reviewID) ?? ""
        phoneNumber = try container.decodeIfPresent(String.self, forKey: .phoneNumber) ?? ""
        moderationRole = try container.decodeIfPresent(String.self, forKey: .moderationRole) ?? "user"
        // Password and in-memory image data are intentionally never persisted.
        password = ""
        avatarImageData = nil
        backgroundImageData = nil
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(email, forKey: .email)
        try container.encode(nickname, forKey: .nickname)
        try container.encode(bio, forKey: .bio)
        try container.encode(followingCount, forKey: .followingCount)
        try container.encode(followersCount, forKey: .followersCount)
        try container.encode(postCount, forKey: .postCount)
        try container.encode(isRestricted, forKey: .isRestricted)
        try container.encode(canShowContact, forKey: .canShowContact)
        try container.encode(avatarSymbol, forKey: .avatarSymbol)
        try container.encode(avatarTint, forKey: .avatarTint)
        try container.encode(redBookID, forKey: .redBookID)
        try container.encode(gender, forKey: .gender)
        try container.encode(birthday, forKey: .birthday)
        try container.encode(region, forKey: .region)
        try container.encode(backgroundImageName, forKey: .backgroundImageName)
        try container.encode(avatarURL, forKey: .avatarURL)
        try container.encode(backgroundURL, forKey: .backgroundURL)
        try container.encodeIfPresent(lastNicknameChangedAt, forKey: .lastNicknameChangedAt)
        try container.encodeIfPresent(moderationStatus, forKey: .moderationStatus)
        try container.encode(moderationReason, forKey: .moderationReason)
        try container.encode(reviewID, forKey: .reviewID)
        try container.encode(phoneNumber, forKey: .phoneNumber)
        try container.encode(moderationRole, forKey: .moderationRole)
    }
}

struct GroupBuyPost: Identifiable, Hashable, Codable {
    let id: String
    var title: String
    var imageNames: [String]
    var uploadedImageData: [Data] = []
    var remoteImageURLs: [String] = []
    var imageObjectKeys: [String] = []
    var previewRemoteImageURLs: [String] = []
    var previewImageObjectKeys: [String] = []
    var authorID: String
    var groupType: GroupBuyType = .followGroup
    var collectionID: String? = nil
    var categoryTags: [String]
    var fandomTags: [String]
    var price: String
    var deposit: String
    var deadline: Date
    var condition: String
    var isFormed: Bool
    var description: String
    var wechat: String
    var qq: String
    var groupNumber: String
    var groupInfo: String
    var externalLink: String
    var createdAt: Date
    var likedCount: Int
    var favoriteCount: Int
    var commentCount: Int
    var reportCount: Int
    var status: ContentStatus
    var moderationReason: String = ""
    var reviewID: String = ""
    var imageAspect: Double
    var pingguAveragePrice: String = ""
    var pingguNote: String = ""
    var unsoldRoles: [UnsoldRole] = []
    var revision: Int = 1

    var isEnded: Bool {
        deadline <= Date()
    }

    var searchableText: String {
        ([title, description, price, deposit, condition, pingguAveragePrice, pingguNote] + categoryTags + fandomTags + unsoldRoles.map(\.name))
            .joined(separator: " ")
    }
}

enum GroupBuyType: String, CaseIterable, Identifiable, Hashable, Codable {
    case followGroup = "跟团"
    case splitGoods = "拼谷"

    var id: String { rawValue }

    var moduleTitle: String {
        switch self {
        case .followGroup: "跟团"
        case .splitGoods: "拼谷"
        }
    }

    var feedDescription: String {
        switch self {
        case .followGroup: "自印团信息流"
        case .splitGoods: "角色余量可筛选"
        }
    }

    var icon: String {
        switch self {
        case .followGroup: "bag.fill"
        case .splitGoods: "person.3.fill"
        }
    }

    var accent: Color {
        switch self {
        case .followGroup: Theme.hotPink
        case .splitGoods: Color(red: 0.25, green: 0.78, blue: 0.72)
        }
    }

    var backendValue: String {
        switch self {
        case .followGroup: "followGroup"
        case .splitGoods: "splitGoods"
        }
    }

    static func backendValue(_ value: String) -> GroupBuyType {
        switch value {
        case "splitGoods", "拼谷":
            return .splitGoods
        default:
            return .followGroup
        }
    }
}

struct UnsoldRole: Identifiable, Hashable, Codable {
    let id: String
    var name: String
    var quantity: Int
    var priceAdjustment: Double

    init(id: String = "role-\(UUID().uuidString)", name: String, quantity: Int, priceAdjustment: Double = 0) {
        self.id = id
        self.name = name
        self.quantity = quantity
        self.priceAdjustment = priceAdjustment
    }

    var isAvailable: Bool {
        quantity > 0 && !name.trimmed.isEmpty
    }

    var priceAdjustmentText: String {
        guard priceAdjustment != 0 else { return "无调价" }
        let value = abs(priceAdjustment)
        let formatted = value.rounded() == value ? String(Int(value)) : String(format: "%.2f", value)
        return "\(priceAdjustment > 0 ? "+" : "-")¥\(formatted)"
    }
}

struct GroupCollection: Identifiable, Hashable, Codable {
    let id: String
    var ownerID: String
    var name: String
    var contactWechat: String
    var contactQQ: String
    var contactGroupNumber: String
    var groupInfo: String
    var deadline: Date
    var defaultNote: String
    var postIDs: [String]
    var createdAt: Date
    var status: ContentStatus = .active
    var revision: Int = 1
    var postCount: Int? = nil

    var isEnded: Bool {
        deadline <= Date()
    }
}

struct ReviewPost: Identifiable, Hashable {
    let id: String
    var imageName: String
    var body: String
    var groupBuyPostID: String
    var publisherID: String
    var authorID: String
    var likedCount: Int
    var commentCount: Int
    var createdAt: Date
}

struct Comment: Identifiable, Hashable, Codable {
    let id: String
    var body: String
    var authorID: String
    var postID: String
    var replyToID: String?
    var createdAt: Date
    var status: ContentStatus
    var moderationReason: String = ""
    var reviewID: String = ""
}

struct MessageThread: Identifiable, Hashable, Codable {
    let id: String
    var buyerUserID: String
    var publisherUserID: String
    var relatedPostID: String?
    var messages: [DirectMessage]
    var unreadCount: Int
    var updatedAt: Date
    var revision: Int? = nil
}

enum MessageDeliveryStatus: String, Hashable, Codable {
    case sent
    case sending
    case failedNetwork
    case failedBlockedPeer
    case failedBlockedByPeer

    var isFailed: Bool { self != .sent && self != .sending }
    var isOutbox: Bool { self != .sent }
}

struct DirectMessage: Identifiable, Hashable, Codable {
    let id: String
    var senderID: String
    var body: String
    var createdAt: Date
    var imageData: Data? = nil
    var imageObjectKey: String = ""
    var remoteImageURL: String = ""
    var isRevoked: Bool = false
    var isDeletedForMe: Bool = false
    var sharedPostID: String? = nil
    var sharedProfileUserID: String? = nil
    var deliveryStatus: MessageDeliveryStatus = .sent
    var revision: Int = 1
    var localImageFileName: String = ""

    init(
        id: String,
        senderID: String,
        body: String,
        createdAt: Date,
        imageData: Data? = nil,
        imageObjectKey: String = "",
        remoteImageURL: String = "",
        isRevoked: Bool = false,
        isDeletedForMe: Bool = false,
        sharedPostID: String? = nil,
        sharedProfileUserID: String? = nil,
        deliveryStatus: MessageDeliveryStatus = .sent,
        revision: Int = 1
    ) {
        self.id = id
        self.senderID = senderID
        self.body = body
        self.createdAt = createdAt
        self.imageData = imageData
        self.imageObjectKey = imageObjectKey
        self.remoteImageURL = remoteImageURL
        self.isRevoked = isRevoked
        self.isDeletedForMe = isDeletedForMe
        self.sharedPostID = sharedPostID
        self.sharedProfileUserID = sharedProfileUserID
        self.deliveryStatus = deliveryStatus
        self.revision = revision
    }

    enum CodingKeys: String, CodingKey {
        case id
        case senderID
        case body
        case createdAt
        case imageData
        case imageObjectKey
        case remoteImageURL
        case isRevoked
        case isDeletedForMe
        case sharedPostID
        case sharedProfileUserID
        case deliveryStatus
        case revision
        case localImageFileName
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        senderID = try container.decode(String.self, forKey: .senderID)
        body = try container.decode(String.self, forKey: .body)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        imageData = try container.decodeIfPresent(Data.self, forKey: .imageData)
        imageObjectKey = try container.decodeIfPresent(String.self, forKey: .imageObjectKey) ?? ""
        remoteImageURL = try container.decodeIfPresent(String.self, forKey: .remoteImageURL) ?? ""
        isRevoked = try container.decodeIfPresent(Bool.self, forKey: .isRevoked) ?? false
        isDeletedForMe = try container.decodeIfPresent(Bool.self, forKey: .isDeletedForMe) ?? false
        sharedPostID = try container.decodeIfPresent(String.self, forKey: .sharedPostID)
        sharedProfileUserID = try container.decodeIfPresent(String.self, forKey: .sharedProfileUserID)
        revision = try container.decodeIfPresent(Int.self, forKey: .revision) ?? 1
        localImageFileName = try container.decodeIfPresent(String.self, forKey: .localImageFileName) ?? ""
        deliveryStatus = (try? container.decode(MessageDeliveryStatus.self, forKey: .deliveryStatus)) ?? .sent
    }
}

struct Report: Identifiable, Hashable {
    let id: String
    var target: ReportTarget
    var reason: String
    var detail: String
    var reporterID: String
    var status: ReportStatus
    var adminResult: String?
    var handledAt: Date?
    var snapshot: ReportEvidence? = nil
    var currentSnapshot: ReportEvidence? = nil
}

struct Reminder: Identifiable, Hashable {
    let id: String
    var userID: String
    var postID: String
    var deadline: Date
    var isUpcoming: Bool
}

struct ReportEvidence: Decodable, Hashable {
    var text: String?
    var version: String?
    var status: String?
    var imageURLs: [String]?
}

enum ReportTarget: Hashable, Identifiable {
    case post(String)
    case comment(String)
    case user(String)
    case message(String)

    var type: String {
        switch self { case .post: "post"; case .comment: "comment"; case .user: "user"; case .message: "message" }
    }
    var targetID: String {
        switch self { case .post(let id), .comment(let id), .user(let id), .message(let id): id }
    }
    var id: String { type + ":" + targetID }
    var label: String {
        switch self { case .post: "帖子"; case .comment: "评论"; case .user: "用户"; case .message: "私信" }
    }
}

enum ContentStatus: String, Hashable, Codable {
    case pending = "待处理"
    case review = "审核中"
    case active = "公开"
    case rejected = "已驳回"
    case hidden = "已隐藏"
    case removed = "已下架"
    case deleted = "已删除"

    var needsOwnerAttention: Bool {
        switch self {
        case .pending, .review, .rejected, .hidden, .removed:
            return true
        case .active, .deleted:
            return false
        }
    }

    var canRepublish: Bool {
        switch self {
        case .rejected, .hidden, .removed:
            return true
        case .pending, .review, .active, .deleted:
            return false
        }
    }
}

enum ReportStatus: String, Hashable {
    case pending = "待处理"
    case ignored = "已忽略"
    case hidden = "已隐藏"
    case removed = "已下架"
    case warned = "已警告"
    case suspended = "账号已停用"
}

enum ColorToken: String, Hashable, Codable {
    case rose
    case violet
    case amber
    case teal
    case blue

    var gradient: LinearGradient {
        switch self {
        case .rose:
            LinearGradient(colors: [Theme.hotPink, Color(red: 0.42, green: 0.08, blue: 0.18)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .violet:
            LinearGradient(colors: [Color(red: 0.58, green: 0.36, blue: 1), Color(red: 0.16, green: 0.11, blue: 0.32)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .amber:
            LinearGradient(colors: [Color(red: 1, green: 0.72, blue: 0.22), Color(red: 0.48, green: 0.23, blue: 0.08)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .teal:
            LinearGradient(colors: [Color(red: 0.18, green: 0.82, blue: 0.72), Color(red: 0.04, green: 0.26, blue: 0.3)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .blue:
            LinearGradient(colors: [Color(red: 0.32, green: 0.58, blue: 1), Color(red: 0.06, green: 0.16, blue: 0.4)], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }
}

extension ContentStatus {
    static func backendValue(_ value: String) -> ContentStatus {
        switch value {
        case "pending", "待处理":
            return .pending
        case "review", "审核中", "待人工审核":
            return .review
        case "active", "公开":
            return .active
        case "rejected", "已驳回":
            return .rejected
        case "hidden", "已隐藏":
            return .hidden
        case "removed", "已下架":
            return .removed
        case "deleted", "已删除":
            return .deleted
        default:
            return .active
        }
    }
}

extension ReportStatus {
    static func backendValue(_ value: String) -> ReportStatus {
        switch value {
        case "ignored", "已忽略":
            return .ignored
        case "hidden", "已隐藏":
            return .hidden
        case "removed", "已下架":
            return .removed
        case "suspended", "账号已停用":
            return .suspended
        case "warned", "已警告":
            return .warned
        default:
            return .pending
        }
    }
}
