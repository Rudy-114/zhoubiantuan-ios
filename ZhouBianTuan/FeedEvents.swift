import Foundation

struct FeedEventDraft: Codable, Sendable {
    let eventID: String
    let requestID: String
    let eventType: String
    let postID: String?
    let position: Int?
    let dwellMs: Int?
    let feedMode: String
    let algorithmVersion: String
    let contentRevision: String
    let occurredAt: Date
    let metadata: [String: String]

    func requestBody() -> [String: Any] {
        let formatter = ISO8601DateFormatter()
        return [
            "eventID": eventID,
            "requestID": requestID,
            "eventType": eventType,
            "postID": postID as Any,
            "position": position as Any,
            "dwellMs": dwellMs as Any,
            "feedMode": feedMode,
            "algorithmVersion": algorithmVersion,
            "contentRevision": contentRevision,
            "occurredAt": formatter.string(from: occurredAt),
            "metadata": metadata
        ]
    }
}

struct BackendFeedEventsResponse: Decodable {
    let accepted: Int?
    let ignored: Int?
    let duplicate: Int?
}
