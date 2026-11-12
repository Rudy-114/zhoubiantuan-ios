import XCTest
import UIKit
@testable import ZhouBianTuan

final class ImagePipelineTests: XCTestCase {
    private func pngData(side: CGFloat = 64) -> Data {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).pngData { context in
            UIColor.systemPink.setFill()
            context.fill(CGRect(x: 0, y: 0, width: side, height: side))
        }
    }

    /// Bytes are seeded into RemoteImageCache memory, so no network request is made.
    private func seed(_ url: String, accountID: String) async {
        await RemoteImageCache.shared.insert(pngData(), for: url, accountID: accountID)
    }

    func testDecodedImagesAreIsolatedPerAccountAndClearedOnLogout() async throws {
        let url = "https://example.test/feed/\(UUID().uuidString).png"
        await seed(url, accountID: "pipeline-a")
        let image = try await ImagePipeline.image(url: url, token: nil, accountID: "pipeline-a", maxPixel: ImagePipeline.Tier.card)
        XCTAssertNotNil(image.cgImage)
        XCTAssertNotNil(ImagePipeline.cachedImage(url: url, accountID: "pipeline-a", maxPixel: ImagePipeline.Tier.card))
        XCTAssertNil(ImagePipeline.cachedImage(url: url, accountID: "pipeline-b", maxPixel: ImagePipeline.Tier.card))
        XCTAssertNil(ImagePipeline.cachedImage(url: url, accountID: "pipeline-a", maxPixel: ImagePipeline.Tier.detail),
                     "each pixel tier is cached separately")

        ImagePipeline.clear(accountID: "pipeline-a")
        XCTAssertNil(ImagePipeline.cachedImage(url: url, accountID: "pipeline-a", maxPixel: ImagePipeline.Tier.card))
        RemoteImageCache.shared.remove(accountID: "pipeline-a")
    }

    func testClearAllDropsEveryAccount() async throws {
        let url = "https://example.test/feed/\(UUID().uuidString).png"
        await seed(url, accountID: "pipeline-c")
        _ = try await ImagePipeline.image(url: url, token: nil, accountID: "pipeline-c", maxPixel: ImagePipeline.Tier.avatar)
        ImagePipeline.clearAll()
        XCTAssertNil(ImagePipeline.cachedImage(url: url, accountID: "pipeline-c", maxPixel: ImagePipeline.Tier.avatar))
        RemoteImageCache.shared.remove(accountID: "pipeline-c")
    }

    func testDownsamplingRespectsPixelTier() {
        let image = ImagePipeline.downsampledImage(from: pngData(side: 1000), maxPixelSize: ImagePipeline.Tier.avatar, scale: 1)
        XCTAssertEqual(image?.cgImage.map { max($0.width, $0.height) }, ImagePipeline.Tier.avatar)
    }

    func testUnregisteredURLIsNeverWrittenToDisk() async {
        let url = "https://example.test/chat/\(UUID().uuidString).png"
        await RemoteImageCache.shared.insert(pngData(), for: url, accountID: "pipeline-d")
        XCTAssertFalse(RemoteImageCache.shared.hasDiskEntry(for: url, accountID: "pipeline-d"))
        RemoteImageCache.shared.remove(accountID: "pipeline-d")
    }
}
