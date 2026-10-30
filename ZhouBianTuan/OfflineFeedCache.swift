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
        lock.lock(); latestWrite = writeID; lock.unlock()
        queue.async { [self] in
            lock.lock(); let isLatest = latestWrite == writeID; lock.unlock()
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
        lock.lock(); latestWrite = nil; lock.unlock()
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

/// A three-day, account-scoped disk cache for remote feed images. Authenticated
/// assets are never shared between accounts, even when their URL is identical.
final class RemoteImageCache: @unchecked Sendable {
    static let shared = RemoteImageCache()
    private let queue = DispatchQueue(label: "com.zhoubiantuan.remote-image-cache", qos: .utility)
    private let lock = NSLock()
    private let root: URL
    private let memory = NSCache<NSString, NSData>()
    private var memoryExpiry: [String: Date] = [:]
    private var allowedKeys = Set<String>()

    init(root: URL? = nil) {
        self.root = root ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("RemoteImageCacheV2", isDirectory: true)
        memory.countLimit = 160
        memory.totalCostLimit = 64 * 1024 * 1024
    }

    /// Registers only the assets that belong to the current offline Feed window.
    /// Ordinary chat/profile image requests never become persistent cache entries.
    func register(_ urls: [String], accountID: String) {
        lock.lock(); defer { lock.unlock() }
        let namespace = Self.digest(accountID)
        urls.forEach { allowedKeys.insert(Self.cacheKey(namespace: namespace, url: $0)) }
    }

    func data(for urlString: String, accountID: String) async -> Data? {
        let namespace = Self.digest(accountID)
        let key = Self.cacheKey(namespace: namespace, url: urlString)
        lock.lock()
        let allowed = allowedKeys.contains(key)
        let expiry = memoryExpiry[key]
        let inMemory = allowed ? memory.object(forKey: key as NSString) : nil
        if let expiry, expiry <= Date() {
            memory.removeObject(forKey: key as NSString)
            memoryExpiry.removeValue(forKey: key)
        }
        lock.unlock()
        guard allowed else { return nil }
        if let inMemory, expiry.map({ $0 > Date() }) ?? false { return inMemory as Data }
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
                lock.lock()
                guard allowedKeys.contains(key) else { lock.unlock(); continuation.resume(returning: nil); return }
                memory.setObject(data as NSData, forKey: key as NSString, cost: data.count)
                memoryExpiry[key] = Date().addingTimeInterval(OfflineFeedCache.retention)
                lock.unlock()
                continuation.resume(returning: data)
            }
        }
    }

    func insert(_ data: Data, for urlString: String, accountID: String) async {
        let namespace = Self.digest(accountID)
        let key = Self.cacheKey(namespace: namespace, url: urlString)
        lock.lock()
        guard allowedKeys.contains(key) else { lock.unlock(); return }
        memory.setObject(data as NSData, forKey: key as NSString, cost: data.count)
        memoryExpiry[key] = Date().addingTimeInterval(OfflineFeedCache.retention)
        lock.unlock()
        await withCheckedContinuation { continuation in
            queue.async { [self] in
                do {
                    let directory = accountDirectory(namespace: namespace)
                    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                    lock.lock()
                    let stillAllowed = allowedKeys.contains(key)
                    lock.unlock()
                    guard stillAllowed, !Task.isCancelled else { continuation.resume(); return }
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
        lock.lock()
        let keys = allowedKeys.filter { $0.hasPrefix(namespace + "|") }
        keys.forEach {
            allowedKeys.remove($0)
            memory.removeObject(forKey: $0 as NSString)
            memoryExpiry.removeValue(forKey: $0)
        }
        lock.unlock()
        queue.async { [self] in
            try? FileManager.default.removeItem(at: accountDirectory(namespace: namespace))
        }
    }

    func remove(urls: [String], accountID: String) {
        let namespace = Self.digest(accountID)
        let keys = urls.map { Self.cacheKey(namespace: namespace, url: $0) }
        lock.lock()
        keys.forEach {
            allowedKeys.remove($0)
            memory.removeObject(forKey: $0 as NSString)
            memoryExpiry.removeValue(forKey: $0)
        }
        lock.unlock()
        queue.async { [self] in
            keys.forEach { key in
                let digest = key.split(separator: "|", maxSplits: 1).last.map(String.init) ?? key
                try? FileManager.default.removeItem(at: accountDirectory(namespace: namespace).appendingPathComponent(digest + ".img"))
            }
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
}
