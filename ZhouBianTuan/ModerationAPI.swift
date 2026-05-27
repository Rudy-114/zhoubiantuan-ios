import Foundation

struct BackendModerationResult: Decodable {
    let outcome: String?
    let status: String?
    let riskLevel: String?
    let source: String?
    let reason: String?

    var localStatus: ContentStatus {
        if let status {
            return ContentStatus.backendValue(status)
        }
        if outcome == "block" {
            return .rejected
        }
        return ContentStatus.backendValue(outcome ?? "active")
    }

    var userMessage: String {
        switch localStatus {
        case .active:
            return "审核通过，内容已公开"
        case .review, .pending:
            return "内容已提交审核，通过后将公开展示"
        case .rejected:
            return reason?.isEmpty == false ? reason! : "内容未通过审核"
        case .hidden:
            return "内容已隐藏"
        case .removed:
            return "内容已下架"
        case .deleted:
            return "内容已删除"
        }
    }
}

struct BackendPostMutationResponse: Decodable {
    let post: BackendPost
    let moderation: BackendModerationResult?
}

struct BackendCommentMutationResponse: Decodable {
    let comment: BackendComment
    let moderation: BackendModerationResult?
}

struct BackendProfileUpdateResponse: Decodable {
    let user: BackendUser
    let moderation: BackendModerationResult?
}

struct BackendModerationReviewsResponse: Decodable {
    let reviews: [BackendModerationReview]
}

struct BackendModerationReviewResponse: Decodable {
    let review: BackendModerationReview
}

struct BackendModerationReview: Decodable {
    let id: String
    let targetType: String
    let targetID: String
    let ownerID: String
    let status: String
    let decision: String?
    let source: String
    let riskLevel: String
    let reason: String
    let textSnapshot: String
    let imageObjectKeys: [String]?
    let imageURLs: [String]?
    let handledAt: String?
    let createdAt: String

    func localReview() -> ModerationReview {
        ModerationReview(
            id: id,
            targetType: ModerationTargetType(rawValue: targetType) ?? .post,
            targetID: targetID,
            ownerID: ownerID,
            status: ModerationQueueStatus(rawValue: status) ?? .review,
            decision: decision.flatMap(ModerationOutcome.init(rawValue:)),
            source: ModerationRiskSource(rawValue: source) ?? .systemRule,
            riskLevel: ModerationRiskLevel.backendValue(riskLevel),
            reason: reason,
            textSnapshot: textSnapshot,
            imageObjectKeys: imageObjectKeys ?? [],
            imageURLs: BackendAssetURLMapper.normalized(imageURLs ?? []),
            createdAt: BackendDateParser.date(from: createdAt),
            handledAt: handledAt.map(BackendDateParser.date(from:))
        )
    }
}

extension ModerationRiskLevel {
    static func backendValue(_ value: String) -> ModerationRiskLevel {
        switch value {
        case "high": .high
        case "medium": .medium
        case "low": .low
        default: .none
        }
    }
}
