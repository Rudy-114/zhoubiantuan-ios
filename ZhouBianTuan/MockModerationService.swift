import Foundation

struct MockModerationService: ModerationService {
    var reviewTrigger = "触发人工审核"
    var blockTrigger = "触发驳回测试"

    func review(_ request: ModerationRequest) async -> ModerationResult {
        if request.text.contains(blockTrigger) {
            return ModerationResult(
                outcome: .block,
                riskLevel: .high,
                source: .textKeyword,
                reason: "内容命中明确违规测试词"
            )
        }

        if request.text.contains(reviewTrigger) {
            return ModerationResult(
                outcome: .review,
                riskLevel: .medium,
                source: .textKeyword,
                reason: "内容命中人工审核测试词"
            )
        }

        return ModerationResult(
            outcome: .pass,
            riskLevel: request.imageData.isEmpty ? .none : .low,
            source: request.imageData.isEmpty ? .systemRule : .imageSignal,
            reason: "模拟审核通过"
        )
    }
}
