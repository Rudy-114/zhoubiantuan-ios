import Foundation

enum ModerationTargetType: String, CaseIterable, Codable, Hashable {
    case post
    case comment
    case collection
    case profileText
    case avatar
    case profileBackground
    case directMessage

    var displayName: String {
        switch self {
        case .post: "帖子"
        case .comment: "评论"
        case .collection: "合集"
        case .profileText: "资料文字"
        case .avatar: "头像"
        case .profileBackground: "主页背景"
        case .directMessage: "私信"
        }
    }
}

enum ModerationOutcome: String, Codable, Hashable {
    case pass
    case review
    case block

    var displayName: String {
        switch self {
        case .pass: "通过"
        case .review: "待人工审核"
        case .block: "驳回"
        }
    }
}

enum ModerationQueueStatus: String, Codable, Hashable {
    case pending
    case active
    case review
    case rejected
    case hidden
    case removed
    case ignored

    var displayName: String {
        switch self {
        case .pending: "待处理"
        case .active: "已通过"
        case .review: "待人工审核"
        case .rejected: "已驳回"
        case .hidden: "已隐藏"
        case .removed: "已下架"
        case .ignored: "已忽略"
        }
    }
}

enum ModerationRiskSource: String, Codable, Hashable {
    case textKeyword
    case imageSignal
    case userReport
    case systemRule
    case manualReview

    var displayName: String {
        switch self {
        case .textKeyword: "文字审核"
        case .imageSignal: "图片审核"
        case .userReport: "用户举报"
        case .systemRule: "系统规则"
        case .manualReview: "人工处理"
        }
    }
}

enum ModerationRiskLevel: Int, Codable, Comparable, Hashable {
    case none = 0
    case low = 1
    case medium = 2
    case high = 3

    static func < (lhs: ModerationRiskLevel, rhs: ModerationRiskLevel) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

struct ModerationRequest: Hashable {
    var targetType: ModerationTargetType
    var targetID: String
    var ownerID: String
    var text: String
    var imageData: [Data]
}

struct ModerationResult: Hashable {
    var outcome: ModerationOutcome
    var riskLevel: ModerationRiskLevel
    var source: ModerationRiskSource
    var reason: String
}

struct ModerationReview: Identifiable, Hashable {
    let id: String
    var targetType: ModerationTargetType
    var targetID: String
    var ownerID: String
    var status: ModerationQueueStatus
    var decision: ModerationOutcome?
    var source: ModerationRiskSource
    var riskLevel: ModerationRiskLevel
    var reason: String
    var textSnapshot: String
    var imageObjectKeys: [String]
    var imageURLs: [String]
    var createdAt: Date
    var handledAt: Date?

    var imageCount: Int {
        max(imageObjectKeys.count, imageURLs.count)
    }
}
