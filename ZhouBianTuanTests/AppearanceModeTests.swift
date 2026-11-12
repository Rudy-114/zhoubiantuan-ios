import XCTest
@testable import ZhouBianTuan

final class AppearanceModeTests: XCTestCase {
    func testFreshInstallFollowsSystem() {
        XCTAssertEqual(AppearanceMode.resolve(stored: nil, legacyDarkMode: nil, isExistingInstall: false), .system)
        XCTAssertNil(AppearanceMode.system.colorScheme)
    }

    func testUpgradeKeepsPreviousAppearance() {
        XCTAssertEqual(AppearanceMode.resolve(stored: nil, legacyDarkMode: true, isExistingInstall: true), .dark)
        XCTAssertEqual(AppearanceMode.resolve(stored: nil, legacyDarkMode: false, isExistingInstall: true), .light)
        // Never toggled on an old build: the old default was dark.
        XCTAssertEqual(AppearanceMode.resolve(stored: nil, legacyDarkMode: nil, isExistingInstall: true), .dark)
    }

    func testStoredModeWinsAndBadValueFallsBack() {
        XCTAssertEqual(AppearanceMode.resolve(stored: "system", legacyDarkMode: true, isExistingInstall: true), .system)
        XCTAssertEqual(AppearanceMode.resolve(stored: "light", legacyDarkMode: true, isExistingInstall: true), .light)
        XCTAssertEqual(AppearanceMode.resolve(stored: "bogus", legacyDarkMode: false, isExistingInstall: true), .light)
    }
}
