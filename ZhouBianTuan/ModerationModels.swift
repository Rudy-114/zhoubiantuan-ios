import Foundation

enum ModerationTargetType: String, CaseIterable, Codable, Hashable {
    case post
    case comment
    case profileText
    case avatar
    case profileBackground
    case directMessage
}

enum ModerationOutcome: String, Codable, Hashable {
    case pass
    case review
    case block
}

enum ModerationQueueStatus: String, Codable, Hashable {
    case pending
    case active
    case review
    case rejected
    case hidden
    case removed
    case ignored
}

enum ModerationRiskSource: String, Codable, Hashable {
    case textKeyword
    case imageSignal
    case userReport
    case systemRule
    case manualReview
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
    var imageCount: Int
    var createdAt: Date
    var handledAt: Date?
}
