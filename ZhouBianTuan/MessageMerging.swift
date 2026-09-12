import Foundation

// History pages and sync both contain partial, authoritative rows. Revisions prevent a
// delayed page/acknowledgement from undoing a newer revocation or unread-state change.
enum MessageMerging {
    static func merge(local: [MessageThread], remote: [MessageThread], userID: String, preserveHistory: Bool) -> [MessageThread] {
        var threads = [String: MessageThread]()
        for var thread in local where thread.buyerUserID == userID || thread.publisherUserID == userID {
            if !preserveHistory { thread.messages.removeAll { !$0.deliveryStatus.isOutbox } }
            if preserveHistory || !thread.messages.isEmpty { threads[thread.id] = thread }
        }
        for incoming in remote where incoming.buyerUserID == userID || incoming.publisherUserID == userID {
            var existing = threads[incoming.id]
            if existing == nil, let alias = threads.values.first(where: {
                Set([$0.buyerUserID, $0.publisherUserID]) == Set([incoming.buyerUserID, incoming.publisherUserID])
            }) {
                existing = threads.removeValue(forKey: alias.id)
            }
            var merged = incoming
            if let existing, (existing.revision ?? 0) > (incoming.revision ?? 0) {
                merged = existing
            }
            var messages = Dictionary((existing?.messages ?? []).map { ($0.id, $0) }, uniquingKeysWith: { _, latest in latest })
            for var message in incoming.messages {
                if let previous = messages[message.id] {
                    if previous.revision > message.revision { continue }
                    if previous.revision == message.revision && (previous.isRevoked || previous.isDeletedForMe) {
                        // Keep an optimistic removal until the server confirms it or a refresh rolls it back.
                        message.isRevoked = message.isRevoked || previous.isRevoked
                        message.isDeletedForMe = message.isDeletedForMe || previous.isDeletedForMe
                    }
                }
                if message.deliveryStatus == .sent {
                    message.imageData = nil
                    message.localImageFileName = ""
                } else if message.imageData == nil {
                    message.imageData = messages[message.id]?.imageData
                }
                if message.isRevoked || message.isDeletedForMe {
                    message.body = ""
                    message.imageData = nil
                    message.localImageFileName = ""
                    message.remoteImageURL = ""
                    message.imageObjectKey = ""
                    message.sharedPostID = nil
                    message.sharedProfileUserID = nil
                }
                messages[message.id] = message
            }
            merged.messages = messages.values.sorted { $0.createdAt == $1.createdAt ? $0.id < $1.id : $0.createdAt < $1.createdAt }
            threads[incoming.id] = merged
        }
        return threads.values.sorted { $0.updatedAt == $1.updatedAt ? $0.id < $1.id : $0.updatedAt > $1.updatedAt }
    }
}
