import Foundation

extension MockAppStore {
    func loadModerationReviews(status: ModerationQueueStatus = .review) {
        guard isBackendEnabled, let backendToken else {
            moderationReviews = []
            return
        }
        let requestID = UUID()
        moderationRequestID = requestID
        runSessionTask { [self] session in
            do {
                let reviews = try await backendClient.moderationReviews(token: backendToken, status: status.rawValue)
                guard isCurrentSession(session), moderationRequestID == requestID else { return }
                moderationReviews = reviews
            } catch {
                guard isCurrentSession(session), moderationRequestID == requestID else { return }
                showToast(error.localizedDescription)
            }
        }
    }

    func handleModerationReview(_ review: ModerationReview, decision: String) {
        guard isBackendEnabled, let backendToken else { return }
        runSessionTask { [self] session in
            do {
                _ = try await backendClient.decideModerationReview(token: backendToken, reviewID: review.id, decision: decision)
                guard isCurrentSession(session) else { return }
                moderationReviews.removeAll { $0.id == review.id }
                await refreshFromBackend(silent: true)
                guard isCurrentSession(session) else { return }
                showToast(ModerationDecisionLabel.message(for: decision))
            } catch {
                guard isCurrentSession(session) else { return }
                showToast(error.localizedDescription)
            }
        }
    }
}

enum ModerationDecisionLabel {
    static func message(for decision: String) -> String {
        switch decision {
        case "approve": return "已通过审核"
        case "reject": return "已驳回内容"
        case "hide": return "已隐藏内容"
        case "remove": return "已下架内容"
        case "ignore": return "已忽略记录"
        default: return "审核处理完成"
        }
    }
}
