import Foundation

protocol ModerationService {
    func review(_ request: ModerationRequest) async -> ModerationResult
}

extension ModerationService {
    func reviewText(targetType: ModerationTargetType, targetID: String, ownerID: String, text: String) async -> ModerationResult {
        await review(
            ModerationRequest(
                targetType: targetType,
                targetID: targetID,
                ownerID: ownerID,
                text: text,
                imageData: []
            )
        )
    }
}
