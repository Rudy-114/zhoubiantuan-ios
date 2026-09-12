import Foundation
import CryptoKit

// One serial utility queue owns encoding and files. The synchronous generation change
// blocks queued old writes; a queued purge runs after any write already in progress.
final class MessageCache: @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.zhoubiantuan.message-cache", qos: .utility)
    private let lock = NSLock()
    private let root: URL
    private var session: UUID?
    private var account: String?
    private var latestWrite: UUID?

    init(root: URL? = nil) {
        self.root = root ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MessageCacheV2", isDirectory: true)
    }

    func configure(account: String, session: UUID) {
        lock.lock(); defer { lock.unlock() }
        self.account = account; self.session = session; latestWrite = nil
    }

    func invalidate(purge: Bool = true) {
        lock.lock()
        let previous = account
        account = nil; session = nil; latestWrite = nil
        lock.unlock()
        if purge, let previous {
            queue.async { [self] in
                try? FileManager.default.removeItem(at: directory(previous))
                // The previous format had no account namespace and is never restored before authentication.
                try? FileManager.default.removeItem(at: legacyURL)
            }
        }
    }

    func loadOutbox(account: String, session: UUID) async throws -> [MessageThread] {
        try await withCheckedThrowingContinuation { continuation in
            queue.async { [self] in
                do {
                    guard isCurrent(account, session) else { continuation.resume(returning: []); return }
                    let ownURL = directory(account).appendingPathComponent("threads.json")
                    let source = FileManager.default.fileExists(atPath: ownURL.path) ? ownURL : legacyURL
                    guard FileManager.default.fileExists(atPath: source.path) else { continuation.resume(returning: []); return }
                    let decoded = try JSONDecoder().decode([MessageThread].self, from: Data(contentsOf: source))
                    var outbox: [MessageThread] = []
                    for var thread in decoded where thread.buyerUserID == account || thread.publisherUserID == account {
                        thread.messages = thread.messages.filter { $0.senderID == account && $0.deliveryStatus.isOutbox && !$0.isDeletedForMe && !$0.isRevoked }.map { item in
                            var message = item
                            if message.deliveryStatus == .sending { message.deliveryStatus = .failedNetwork }
                            if message.imageData == nil, isImageFileName(message.localImageFileName) {
                                message.imageData = try? Data(contentsOf: directory(account).appendingPathComponent("images").appendingPathComponent(message.localImageFileName))
                            }
                            return message
                        }
                        if !thread.messages.isEmpty { outbox.append(thread) }
                    }
                    guard isCurrent(account, session) else { continuation.resume(returning: []); return }
                    continuation.resume(returning: outbox)
                } catch { continuation.resume(throwing: error) }
            }
        }
    }

    func enqueue(_ snapshot: [MessageThread], account: String, session: UUID, onError: @escaping @Sendable (String) -> Void) {
        let writeID = UUID()
        lock.lock()
        guard self.account == account, self.session == session else { lock.unlock(); return }
        latestWrite = writeID
        lock.unlock()
        queue.asyncAfter(deadline: .now() + 0.3) { [self] in
            guard isCurrent(account, session, writeID) else { return }
            do {
                let dir = directory(account), imageDir = dir.appendingPathComponent("images", isDirectory: true)
                try FileManager.default.createDirectory(at: imageDir, withIntermediateDirectories: true,
                    attributes: [.protectionKey: FileProtectionType.complete])
                var metadata = snapshot.filter { $0.buyerUserID == account || $0.publisherUserID == account }
                var retained = Set<String>()
                for threadIndex in metadata.indices {
                    for messageIndex in metadata[threadIndex].messages.indices {
                        var message = metadata[threadIndex].messages[messageIndex]
                        if message.deliveryStatus.isOutbox && !message.isRevoked && !message.isDeletedForMe {
                            if let data = message.imageData {
                                let name = digest(message.id) + ".jpg"
                                try data.write(to: imageDir.appendingPathComponent(name), options: [.atomic, .completeFileProtection])
                                message.localImageFileName = name
                            }
                            if isImageFileName(message.localImageFileName) { retained.insert(message.localImageFileName) }
                        } else { message.localImageFileName = "" }
                        message.imageData = nil
                        if message.isRevoked || message.isDeletedForMe {
                            message.body = ""; message.remoteImageURL = ""; message.imageObjectKey = ""
                            message.sharedPostID = nil; message.sharedProfileUserID = nil
                        }
                        metadata[threadIndex].messages[messageIndex] = message
                    }
                }
                let data = try JSONEncoder().encode(metadata)
                guard isCurrent(account, session, writeID) else { return }
                try data.write(to: dir.appendingPathComponent("threads.json"), options: [.atomic, .completeFileProtection])
                var protected = dir
                var values = URLResourceValues(); values.isExcludedFromBackup = true
                try protected.setResourceValues(values)
                for url in try FileManager.default.contentsOfDirectory(at: imageDir, includingPropertiesForKeys: nil) {
                    if isImageFileName(url.lastPathComponent), !retained.contains(url.lastPathComponent) { try FileManager.default.removeItem(at: url) }
                }
            } catch {
                if isCurrent(account, session, writeID) { onError("聊天草稿暂时无法保存到本机，请保留当前页面后重试") }
            }
        }
    }

    func waitForPendingWrites() async {
        await withCheckedContinuation { continuation in
            queue.asyncAfter(deadline: .now() + 0.35) { continuation.resume() }
        }
    }

    private var legacyURL: URL { root.deletingLastPathComponent().appendingPathComponent("zhoubiantuan-message-threads.json") }
    private func directory(_ account: String) -> URL { root.appendingPathComponent(digest(account), isDirectory: true) }
    private func digest(_ text: String) -> String { SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined() }
    private func isImageFileName(_ name: String) -> Bool { name.range(of: "^[a-f0-9]{64}\\.jpg$", options: .regularExpression) != nil }
    private func isCurrent(_ account: String, _ session: UUID, _ write: UUID? = nil) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return self.account == account && self.session == session && (write == nil || latestWrite == write)
    }
}
