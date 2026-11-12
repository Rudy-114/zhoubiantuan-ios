import ImageIO
import UIKit

/// Decoded-image layer on top of `RemoteAssetRequest` (raw bytes, request
/// coalescing and the account-scoped `RemoteImageCache`).
///
/// - Decoded images are kept in memory per account and per pixel tier, so a
///   card that scrolls back into view is shown on its first frame.
/// - Decoding and downsampling run off the main actor.
enum ImagePipeline {
    /// Pixel tiers. Pick the smallest tier that covers `points x screen scale`.
    enum Tier {
        static let avatar = 256
        static let card = 720
        static let background = 1280
        static let detail = 1600
    }

    private static let storage = ImagePipelineStorage()

    /// Synchronous memory lookup, used by views to render a cached image on the
    /// first frame instead of flashing a placeholder.
    static func cachedImage(url: String, accountID: String, maxPixel: Int) -> UIImage? {
        storage.image(forKey: key(url: url, accountID: accountID, maxPixel: maxPixel))
    }

    static func image(url: String, token: String?, accountID: String, maxPixel: Int, scale: CGFloat = 1) async throws -> UIImage {
        let cacheKey = key(url: url, accountID: accountID, maxPixel: maxPixel)
        if let cached = storage.image(forKey: cacheKey) { return cached }
        let data = try await RemoteAssetRequest.data(urlString: url, token: token, accountID: accountID)
        try Task.checkCancellation()
        let decoded = await Task.detached(priority: .userInitiated) {
            downsampledImage(from: data, maxPixelSize: maxPixel, scale: scale)
        }.value
        guard let decoded else { throw URLError(.cannotDecodeContentData) }
        storage.insert(decoded, forKey: cacheKey, accountID: accountID)
        return decoded
    }

    /// Log out / account switch: decoded images of that account must not be
    /// shown to the next one.
    static func clear(accountID: String) {
        storage.removeAll(accountID: accountID)
    }

    /// Memory warning.
    static func clearAll() {
        storage.removeAll()
    }

    /// Plain (not hashed) key: it never leaves memory, and it is computed while
    /// rendering, so it must stay cheap.
    static func key(url: String, accountID: String, maxPixel: Int) -> String {
        accountID + "|" + RemoteAssetRequest.canonicalURLString(url) + "|" + String(maxPixel)
    }

    static func downsampledImage(from data: Data, maxPixelSize: Int, scale: CGFloat) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: cgImage, scale: max(scale, 1), orientation: .up)
    }
}

private final class ImagePipelineStorage: @unchecked Sendable {
    private let cache = NSCache<NSString, UIImage>()
    private let lock = NSLock()
    /// NSCache cannot be enumerated; remember which keys belong to which account.
    private var keysByAccount: [String: Set<String>] = [:]
    private var memoryWarningObserver: NSObjectProtocol?

    init() {
        cache.totalCostLimit = 120 * 1024 * 1024
        memoryWarningObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: nil
        ) { [weak self] _ in
            self?.removeAll()
        }
    }

    func image(forKey key: String) -> UIImage? {
        cache.object(forKey: key as NSString)
    }

    func insert(_ image: UIImage, forKey key: String, accountID: String) {
        let cost = image.cgImage.map { $0.bytesPerRow * $0.height } ?? Int(image.size.width * image.size.height * 4)
        _ = lock.withLock { keysByAccount[accountID, default: []].insert(key) }
        cache.setObject(image, forKey: key as NSString, cost: cost)
    }

    func removeAll(accountID: String) {
        let keys = lock.withLock { keysByAccount.removeValue(forKey: accountID) ?? [] }
        keys.forEach { cache.removeObject(forKey: $0 as NSString) }
    }

    func removeAll() {
        lock.withLock { keysByAccount.removeAll() }
        cache.removeAllObjects()
    }
}
