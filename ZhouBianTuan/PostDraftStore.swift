import Foundation
import CryptoKit

/// A local, account-scoped draft. Images are normalized before being stored by
/// CreatePostView, so reopening a draft never needs the network.
struct PostDraft: Identifiable, Codable, Hashable {
    let id: String
    let ownerID: String
    var updatedAt: Date
    var title: String
    var groupType: GroupBuyType?
    var collectionID: String
    var imageData: [Data]
    var tags: [String]
    var priceLowerBound: String
    var priceUpperBound: String
    var depositPercent: String
    var deadline: Date
    var condition: String
    var wechat: String
    var qq: String
    var groupInfo: String
    var description: String
    var pingguAveragePrice: String
    var pingguNote: String
    var roleDrafts: [UnsoldRole]

    var previewTitle: String { title.trimmed.isEmpty ? "未命名草稿" : title.trimmed }
}

final class PostDraftStore {
    static let shared = PostDraftStore()
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let root: URL

    init(root: URL? = nil) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        self.encoder = encoder
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder
        self.root = root ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PostDraftsV1", isDirectory: true)
    }

    func drafts(ownerID: String) -> [PostDraft] {
        guard let data = try? Data(contentsOf: fileURL(ownerID: ownerID)),
              let value = try? decoder.decode([PostDraft].self, from: data) else { return [] }
        return value.sorted { $0.updatedAt > $1.updatedAt }
    }

    func save(_ draft: PostDraft) {
        var values = drafts(ownerID: draft.ownerID).filter { $0.id != draft.id }
        values.insert(draft, at: 0)
        values = Array(values.prefix(20))
        do {
            let directory = accountDirectory(ownerID: draft.ownerID)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try encoder.encode(values).write(to: fileURL(ownerID: draft.ownerID), options: [.atomic, .completeFileProtection])
        } catch {
            // Draft persistence is best effort and must never block publishing.
        }
    }

    func remove(_ draft: PostDraft) {
        let values = drafts(ownerID: draft.ownerID).filter { $0.id != draft.id }
        do {
            try encoder.encode(values).write(to: fileURL(ownerID: draft.ownerID), options: [.atomic, .completeFileProtection])
        } catch { }
    }

    func remove(id: String, ownerID: String) {
        let values = drafts(ownerID: ownerID).filter { $0.id != id }
        do {
            try encoder.encode(values).write(to: fileURL(ownerID: ownerID), options: [.atomic, .completeFileProtection])
        } catch { }
    }

    private func accountDirectory(ownerID: String) -> URL {
        root.appendingPathComponent(Self.digest(ownerID), isDirectory: true)
    }

    private func fileURL(ownerID: String) -> URL {
        accountDirectory(ownerID: ownerID).appendingPathComponent("drafts.json")
    }

    private static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
