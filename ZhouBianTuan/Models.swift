import Foundation
import SwiftUI

struct User: Identifiable, Hashable {
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
}

struct GroupBuyPost: Identifiable, Hashable {
    let id: String
    var title: String
    var imageNames: [String]
    var uploadedImageData: [Data] = []
    var remoteImageURLs: [String] = []
    var imageObjectKeys: [String] = []
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

    var isEnded: Bool {
        deadline <= Date()
    }

    var searchableText: String {
        ([title, description, price, deposit, condition, pingguAveragePrice, pingguNote] + categoryTags + fandomTags + unsoldRoles.map(\.name))
            .joined(separator: " ")
    }
}

enum GroupBuyType: String, CaseIterable, Identifiable, Hashable {
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

struct UnsoldRole: Identifiable, Hashable {
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

struct GroupCollection: Identifiable, Hashable {
    let id: String
    var ownerID: String
    var name: String
    var contactWechat: String
    var contactQQ: String
    var groupInfo: String
    var deadline: Date
    var defaultNote: String
    var postIDs: [String]
    var createdAt: Date
    var status: ContentStatus = .active

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

struct Comment: Identifiable, Hashable {
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
}

struct DirectMessage: Identifiable, Hashable, Codable {
    let id: String
    var senderID: String
    var body: String
    var createdAt: Date
    var imageData: Data? = nil
    var sharedPostID: String? = nil
    var sharedProfileUserID: String? = nil
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
}

struct Reminder: Identifiable, Hashable {
    let id: String
    var userID: String
    var postID: String
    var deadline: Date
    var remindAt: Date
    var hasReminded: Bool
}

enum ReportTarget: Hashable {
    case post(String)
    case comment(String)
}

enum ContentStatus: String, Hashable {
    case pending = "待处理"
    case review = "审核中"
    case active = "公开"
    case rejected = "已驳回"
    case hidden = "已隐藏"
    case removed = "已下架"
    case deleted = "已删除"
}

enum ReportStatus: String, Hashable {
    case pending = "待处理"
    case ignored = "已忽略"
    case hidden = "已隐藏"
    case removed = "已下架"
    case warned = "已警告"
}

enum ColorToken: String, Hashable {
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
        case "warned", "已警告":
            return .warned
        default:
            return .pending
        }
    }
}
