import Foundation
import CryptoKit

/// A small, account-scoped snapshot used to make the personalized home feed useful
/// immediately after a cold launch without a network connection.
struct OfflineFeedPage: Codable, Hashable {
    let key: String
    let ids: [String]
    let nextCursor: String?
    let hasMore: Bool
}

struct OfflineFeedSnapshot: Codable, Hashable {
    let accountID: String
    let savedAt: Date
    let pages: [OfflineFeedPage]
    let users: [User]
    let posts: [GroupBuyPost]
    let collections: [GroupCollection]
    let comments: [Comment]
}

/// Persists only personalized Feed entities and their comments. Each account has
/// its own directory so logging out can never expose another account's Feed.
final class OfflineFeedCache: @unchecked Sendable {
    static let shared = OfflineFeedCache()
    static let retention: TimeInterval = 3 * 24 * 60 * 60
    static let maximumPostsPerPage = 10

    private let queue = DispatchQueue(label: "com.zhoubiantuan.offline-feed-cache", qos: .utility)
    private let lock = NSLock()
    private let root: URL
    private var latestWrite: UUID?

    init(root: URL? = nil) {
        self.root = root ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("OfflineFeedCacheV1", isDirectory: true)
    }

    func load(accountID: String) async -> OfflineFeedSnapshot? {
        await withCheckedContinuation { continuation in
            queue.async { [self] in
                let url = fileURL(accountID: accountID)
                guard let data = try? Data(contentsOf: url),
                      let snapshot = try? JSONDecoder.feedCache.decode(OfflineFeedSnapshot.self, from: data),
                      snapshot.accountID == accountID,
                      Date().timeIntervalSince(snapshot.savedAt) <= Self.retention else {
                    if FileManager.default.fileExists(atPath: url.path) {
                        try? FileManager.default.removeItem(at: url)
                    }
                    continuation.resume(returning: nil)
                    return
                }
                continuation.resume(returning: snapshot)
            }
        }
    }

    func save(_ snapshot: OfflineFeedSnapshot) {
        let writeID = UUID()
        lock.withLock { latestWrite = writeID }
        queue.async { [self] in
            let isLatest = lock.withLock { latestWrite == writeID }
            guard isLatest else { return }
            do {
                let directory = accountDirectory(accountID: snapshot.accountID)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let data = try JSONEncoder.feedCache.encode(snapshot)
                try data.write(to: fileURL(accountID: snapshot.accountID), options: [.atomic, .completeFileProtection])
                var values = URLResourceValues()
                values.isExcludedFromBackup = true
                var protectedDirectory = directory
                try protectedDirectory.setResourceValues(values)
            } catch {
                // Offline support is best effort. A failed write must never affect
                // the online Feed or block the main actor.
            }
        }
    }

    func remove(accountID: String) {
        lock.withLock { latestWrite = nil }
        queue.async { [self] in
            try? FileManager.default.removeItem(at: accountDirectory(accountID: accountID))
        }
    }

    private func accountDirectory(accountID: String) -> URL {
        root.appendingPathComponent(Self.digest(accountID), isDirectory: true)
    }

    private func fileURL(accountID: String) -> URL {
        accountDirectory(accountID: accountID).appendingPathComponent("snapshot.json")
    }

    private static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

extension JSONEncoder {
    fileprivate static var feedCache: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

extension JSONDecoder {
    fileprivate static var feedCache: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

/// Account-scoped cache for remote image bytes. Authenticated assets are never
/// shared between accounts, even when their URL is identical.
///
/// - Memory: every URL, for the current session.
/// - Disk (three days): only URLs registered for the offline Feed window, so
///   chat and other private images never land on disk.
final class RemoteImageCache: @unchecked Sendable {
    static let shared = RemoteImageCache()
    private let queue = DispatchQueue(label: "com.zhoubiantuan.remote-image-cache", qos: .utility)
    private let lock = NSLock()
    private let root: URL
    private let memory = NSCache<NSString, NSData>()
    /// NSCache cannot be enumerated; remember keys so one account can be purged.
    private var memoryKeys = Set<String>()
    private var allowedKeys = Set<String>()

    init(root: URL? = nil) {
        self.root = root ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("RemoteImageCacheV2", isDirectory: true)
        memory.countLimit = 400
        memory.totalCostLimit = 64 * 1024 * 1024
    }

    /// Registers only the assets that belong to the current offline Feed window.
    /// Ordinary chat/profile image requests never become persistent cache entries.
    func register(_ urls: [String], accountID: String) {
        let namespace = Self.digest(accountID)
        lock.withLock {
            urls.forEach { allowedKeys.insert(Self.cacheKey(namespace: namespace, url: $0)) }
        }
    }

    /// Whether `urlString` may be written to disk for this account.
    func isPersistable(_ urlString: String, accountID: String) -> Bool {
        let key = Self.cacheKey(namespace: Self.digest(accountID), url: urlString)
        return lock.withLock { allowedKeys.contains(key) }
    }

    func data(for urlString: String, accountID: String) async -> Data? {
        let namespace = Self.digest(accountID)
        let key = Self.cacheKey(namespace: namespace, url: urlString)
        let (cached, allowed) = memoryLookup(key)
        if let cached { return cached }
        guard allowed else { return nil }
        return await withCheckedContinuation { continuation in
            queue.async { [self] in
                let url = fileURL(namespace: namespace, url: urlString)
                guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
                      let modified = attributes[.modificationDate] as? Date,
                      Date().timeIntervalSince(modified) <= OfflineFeedCache.retention,
                      let data = try? Data(contentsOf: url) else {
                    if FileManager.default.fileExists(atPath: url.path) { try? FileManager.default.removeItem(at: url) }
                    continuation.resume(returning: nil)
                    return
                }
                // The key may have been revoked (blocked author, logout) while reading.
                guard isAllowed(key) else { continuation.resume(returning: nil); return }
                storeInMemory(data, key: key)
                continuation.resume(returning: data)
            }
        }
    }

    func insert(_ data: Data, for urlString: String, accountID: String) async {
        let namespace = Self.digest(accountID)
        let key = Self.cacheKey(namespace: namespace, url: urlString)
        storeInMemory(data, key: key)
        guard isAllowed(key) else { return }
        await withCheckedContinuation { continuation in
            queue.async { [self] in
                do {
                    let directory = accountDirectory(namespace: namespace)
                    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                    guard isAllowed(key), !Task.isCancelled else { continuation.resume(); return }
                    try data.write(to: fileURL(namespace: namespace, url: urlString), options: [.atomic, .completeFileProtection])
                } catch {
                    // Memory caching still provides a useful session-level fallback.
                }
                continuation.resume()
            }
        }
    }

    func remove(accountID: String) {
        let namespace = Self.digest(accountID)
        lock.withLock {
            allowedKeys = allowedKeys.filter { !$0.hasPrefix(namespace + "|") }
            let keys = memoryKeys.filter { $0.hasPrefix(namespace + "|") }
            keys.forEach { memory.removeObject(forKey: $0 as NSString) }
            memoryKeys.subtract(keys)
        }
        queue.async { [self] in
            try? FileManager.default.removeItem(at: accountDirectory(namespace: namespace))
        }
    }

    func remove(urls: [String], accountID: String) {
        let namespace = Self.digest(accountID)
        let keys = urls.map { Self.cacheKey(namespace: namespace, url: $0) }
        lock.withLock {
            keys.forEach {
                allowedKeys.remove($0)
                memoryKeys.remove($0)
                memory.removeObject(forKey: $0 as NSString)
            }
        }
        queue.async { [self] in
            keys.forEach { key in
                let digest = key.split(separator: "|", maxSplits: 1).last.map(String.init) ?? key
                try? FileManager.default.removeItem(at: accountDirectory(namespace: namespace).appendingPathComponent(digest + ".img"))
            }
        }
    }

    // Synchronous critical sections: NSLock must not be held across `await`.
    private func memoryLookup(_ key: String) -> (Data?, Bool) {
        lock.withLock { (memory.object(forKey: key as NSString) as Data?, allowedKeys.contains(key)) }
    }

    private func isAllowed(_ key: String) -> Bool {
        lock.withLock { allowedKeys.contains(key) }
    }

    private func storeInMemory(_ data: Data, key: String) {
        lock.withLock {
            memory.setObject(data as NSData, forKey: key as NSString, cost: data.count)
            memoryKeys.insert(key)
        }
    }

    private func accountDirectory(namespace: String) -> URL {
        root.appendingPathComponent(namespace, isDirectory: true)
    }

    private func fileURL(namespace: String, url: String) -> URL {
        accountDirectory(namespace: namespace).appendingPathComponent(Self.digest(url) + ".img")
    }

    private static func cacheKey(namespace: String, url: String) -> String {
        namespace + "|" + digest(url)
    }

    private static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// Test hook: whether a file exists on disk for this URL and account.
    func hasDiskEntry(for urlString: String, accountID: String) -> Bool {
        FileManager.default.fileExists(atPath: fileURL(namespace: Self.digest(accountID), url: urlString).path)
    }
}
