import XCTest
import CryptoKit
@testable import ZhouBianTuan

final class MessageConsistencyTests: XCTestCase {
    private func thread(_ messages: [DirectMessage], id: String = "t-server", revision: Int = 1) -> MessageThread {
        MessageThread(id: id, buyerUserID: "A", publisherUserID: "B", relatedPostID: nil, messages: messages,
            unreadCount: 0, updatedAt: Date(timeIntervalSince1970: 100), revision: revision)
    }

    func testDelayedHistoryCannotRestoreRevokedTextImageOrSharedPost() {
        let sent = DirectMessage(id: "m-one", senderID: "B", body: "Private content", createdAt: Date(),
            imageData: Data([1,2,3]), remoteImageURL: "https://example.test/private.jpg", sharedPostID: "p-private", revision: 1)
        let revoked = DirectMessage(id: "m-one", senderID: "B", body: "", createdAt: sent.createdAt, isRevoked: true, revision: 2)
        let latest = MessageMerging.merge(local: [thread([sent])], remote: [thread([revoked], revision: 2)], userID: "A", preserveHistory: true)
        let delayed = MessageMerging.merge(local: latest, remote: [thread([sent])], userID: "A", preserveHistory: true)
        let message = delayed[0].messages[0]
        XCTAssertTrue(message.isRevoked)
        XCTAssertEqual(message.body, "")
        XCTAssertNil(message.imageData)
        XCTAssertEqual(message.remoteImageURL, "")
        XCTAssertNil(message.sharedPostID)
        XCTAssertEqual(message.revision, 2)
        XCTAssertEqual(delayed[0].revision, 2)
    }

    func testReadMetadataPreservesHistoryButBootstrapOnlyRetainsUnconfirmedOutbox() {
        let history = (0..<615).map { DirectMessage(id: "m-\($0)", senderID: "B", body: "History", createdAt: Date()) }
        let pending = DirectMessage(id: "m-pending", senderID: "A", body: "Keep draft", createdAt: Date(), deliveryStatus: .sending)
        let local = thread(history + [pending])
        let updated = MessageMerging.merge(local: [local], remote: [thread([], revision: 2)], userID: "A", preserveHistory: true)
        XCTAssertEqual(updated[0].messages.count, 616)
        let bootstrapped = MessageMerging.merge(local: [local], remote: [thread([], revision: 2)], userID: "A", preserveHistory: false)
        XCTAssertEqual(bootstrapped[0].messages.map(\.id), [pending.id])
        XCTAssertEqual(bootstrapped[0].messages[0].deliveryStatus, .sending)
    }

    func testAcknowledgementReconcilesTemporaryThreadAndDropsUploadedImageData() {
        let pending = DirectMessage(id: "m-pending", senderID: "A", body: "[图片]", createdAt: Date(), imageData: Data([1,2,3]), deliveryStatus: .sending)
        let confirmed = DirectMessage(id: pending.id, senderID: "A", body: "[图片]", createdAt: pending.createdAt, remoteImageURL: "https://example.test/image")
        let merged = MessageMerging.merge(local: [thread([pending], id: "t-local")], remote: [thread([confirmed])], userID: "A", preserveHistory: true)
        XCTAssertEqual(merged.count, 1)
        XCTAssertEqual(merged[0].id, "t-server")
        XCTAssertEqual(merged[0].messages[0].deliveryStatus, .sent)
        XCTAssertNil(merged[0].messages[0].imageData)
    }

    func testQueuedWritesCannotRecreateTheLoggedOutAccountsCache() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("cache-test-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = MessageCache(root: root), sessionA = UUID(), sessionB = UUID()
        cache.configure(account: "A", session: sessionA)
        let secret = DirectMessage(id: "m-a", senderID: "A", body: "Secret A draft", createdAt: Date(), deliveryStatus: .failedNetwork)
        cache.enqueue([thread([secret])], account: "A", session: sessionA) { XCTFail($0) }
        cache.invalidate()
        cache.configure(account: "B", session: sessionB)
        let other = DirectMessage(id: "m-b", senderID: "B", body: "B draft", createdAt: Date(), deliveryStatus: .failedNetwork)
        cache.enqueue([thread([other])], account: "B", session: sessionB) { XCTFail($0) }
        await cache.waitForPendingWrites()
        let b = try await cache.loadOutbox(account: "B", session: sessionB)
        XCTAssertEqual(b.flatMap(\.messages).map(\.body), ["B draft"])
        let freshA = UUID()
        cache.configure(account: "A", session: freshA)
        let a = try await cache.loadOutbox(account: "A", session: freshA)
        XCTAssertTrue(a.isEmpty)
    }

    func testOutboxImagesAreSeparateFromMetadataAndRestoreAsRetryableDrafts() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("cache-images-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = MessageCache(root: root), session = UUID(), image = Data(repeating: 42, count: 1024)
        cache.configure(account: "A", session: session)
        let pending = DirectMessage(id: "m-image", senderID: "A", body: "[图片]", createdAt: Date(), imageData: image, deliveryStatus: .sending)
        let sent = DirectMessage(id: "m-sent", senderID: "A", body: "[图片]", createdAt: Date(), imageData: image, remoteImageURL: "https://example.test/image")
        cache.enqueue([thread([pending,sent])], account: "A", session: session) { XCTFail($0) }
        await cache.waitForPendingWrites()
        let accountDir = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil).first)
        let metadata = try String(contentsOf: accountDir.appendingPathComponent("threads.json"), encoding: .utf8)
        XCTAssertFalse(metadata.contains("imageData"))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: accountDir.appendingPathComponent("images").path).count, 1)
        let restored = try await cache.loadOutbox(account: "A", session: session)
        XCTAssertEqual(restored.flatMap(\.messages).count, 1)
        XCTAssertEqual(restored[0].messages[0].imageData, image)
        XCTAssertEqual(restored[0].messages[0].deliveryStatus, .failedNetwork)
    }
}

final class OfflineFeedCacheTests: XCTestCase {
    func testSnapshotIsAccountScopedAndWrittenAtomically() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("offline-feed-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = OfflineFeedCache(root: root)
        let snapshot = OfflineFeedSnapshot(accountID: "account-a", savedAt: Date(), pages: [], users: [], posts: [], collections: [], comments: [])
        cache.save(snapshot)
        let newer = OfflineFeedSnapshot(accountID: "account-a", savedAt: Date(), pages: [OfflineFeedPage(key: "/feed?groupType=followGroup", ids: ["p-1"], nextCursor: nil, hasMore: false)], users: [], posts: [], collections: [], comments: [])
        cache.save(newer)
        let loadedA = await cache.load(accountID: "account-a")
        XCTAssertEqual(loadedA?.pages.first?.ids, ["p-1"])
        let loadedB = await cache.load(accountID: "account-b")
        XCTAssertNil(loadedB)
        cache.remove(accountID: "account-a")
        let removed = await cache.load(accountID: "account-a")
        XCTAssertNil(removed)
    }

    func testExpiredSnapshotIsDeletedOnRead() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("offline-feed-expired-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = OfflineFeedCache(root: root)
        let account = "account-expired"
        let snapshot = OfflineFeedSnapshot(accountID: account, savedAt: Date(timeIntervalSinceNow: -OfflineFeedCache.retention - 1), pages: [], users: [], posts: [], collections: [], comments: [])
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        let digest = SHA256.hash(data: Data(account.utf8)).map { String(format: "%02x", $0) }.joined()
        let directory = root.appendingPathComponent(digest, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try encoder.encode(snapshot).write(to: directory.appendingPathComponent("snapshot.json"))
        let loaded = await cache.load(accountID: account)
        XCTAssertNil(loaded)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("snapshot.json").path))
    }

    func testRemoteImageCacheRequiresFeedRegistrationAndIsAccountScoped() async {
        let url = "https://example.test/feed/\(UUID().uuidString).jpg"
        let data = Data([1, 2, 3])
        let cache = RemoteImageCache.shared
        await cache.insert(data, for: url, accountID: "unregistered")
        let unregistered = await cache.data(for: url, accountID: "unregistered")
        XCTAssertNil(unregistered)
        cache.register([url], accountID: "account-a")
        await cache.insert(data, for: url, accountID: "account-a")
        let loaded = await cache.data(for: url, accountID: "account-a")
        XCTAssertEqual(loaded, data)
        let wrongAccount = await cache.data(for: url, accountID: "account-b")
        XCTAssertNil(wrongAccount)
        cache.remove(accountID: "account-a")
        let removed = await cache.data(for: url, accountID: "account-a")
        XCTAssertNil(removed)
    }
}
