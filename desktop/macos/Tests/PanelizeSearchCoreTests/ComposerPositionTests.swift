import XCTest
@testable import PanelizeSearchCore

final class ComposerPositionTests: XCTestCase {
    func testCentersComposerInLowerPartOfMainDisplay() {
        let visible = CGRect(x: 0, y: 0, width: 1440, height: 875)
        let size = CGSize(width: 680, height: 164)

        let origin = composerOrigin(visibleFrame: visible, panelSize: size)

        XCTAssertEqual(origin.x, 380)
        XCTAssertEqual(origin.y, 105, accuracy: 0.001)
        XCTAssertTrue(visible.contains(CGRect(origin: origin, size: size)))
    }

    func testUsesVisibleAreaOfDisplayWithNegativeOrigin() {
        let visible = CGRect(x: -1920, y: -25, width: 1920, height: 1055)
        let size = CGSize(width: 680, height: 164)

        let origin = composerOrigin(visibleFrame: visible, panelSize: size)

        XCTAssertEqual(origin.x, -1300)
        XCTAssertEqual(origin.y, 101.6, accuracy: 0.001)
        XCTAssertTrue(visible.contains(CGRect(origin: origin, size: size)))
    }
}
