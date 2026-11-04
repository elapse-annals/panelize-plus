import XCTest
@testable import PanelizeSearchCore

final class ComposerLayoutTests: XCTestCase {
    func testInputHeightClampsTextHeightToBaseAndMaximum() {
        XCTAssertEqual(composerInputHeight(forTextHeight: 0), 74)
        XCTAssertEqual(composerInputHeight(forTextHeight: 32), 74)
        XCTAssertEqual(composerInputHeight(forTextHeight: 74), 74)
        XCTAssertEqual(composerInputHeight(forTextHeight: 80), 80)
        XCTAssertEqual(composerInputHeight(forTextHeight: 104), 104)
        XCTAssertEqual(composerInputHeight(forTextHeight: 128), 128)
        XCTAssertEqual(composerInputHeight(forTextHeight: 400), 128)
    }

    func testInputHeightRoundsFractionalTextUp() {
        XCTAssertEqual(composerInputHeight(forTextHeight: 80.1), 81)
    }

    func testContentHeightGrowsWithInputHeight() {
        XCTAssertEqual(composerContentHeight(inputHeight: 74), 164)
        XCTAssertEqual(composerContentHeight(inputHeight: 104), 194)
        XCTAssertEqual(composerContentHeight(inputHeight: 128), 218)
    }

    func testContentHeightAddsSuggestionRows() {
        XCTAssertEqual(composerSuggestionHeight(rowCount: 0), 0)
        XCTAssertEqual(composerSuggestionHeight(rowCount: 1), 38)
        XCTAssertEqual(composerSuggestionHeight(rowCount: 3), 98)
        XCTAssertEqual(composerSuggestionHeight(rowCount: 9), 98)
        XCTAssertEqual(composerContentHeight(inputHeight: 74, suggestionHeight: 0), 164)
    }

    func testCardHeightIgnoresTheHistoryPanel() {
        XCTAssertEqual(composerCardHeight(inputHeight: 74), 164)
        XCTAssertEqual(composerCardHeight(inputHeight: 104), 194)
        XCTAssertEqual(composerCardHeight(inputHeight: 128), 218)
    }

    func testHistoryPanelHeightIncludesHeaderAndRows() {
        XCTAssertEqual(composerHistoryPanelHeight(rowCount: 0), 0)
        XCTAssertEqual(
            composerHistoryPanelHeight(rowCount: 1),
            composerHistoryPanelPadding * 2
                + composerHistoryHeaderHeight
                + composerHistoryHeaderGap
                + composerSuggestionHeight(rowCount: 1)
        )
        XCTAssertEqual(composerHistoryPanelHeight(rowCount: 3), 132)
        XCTAssertEqual(composerHistoryPanelHeight(rowCount: 9), 132)
    }

    func testContentHeightAddsVisibleHistoryPanel() {
        XCTAssertEqual(
            composerContentHeight(inputHeight: 74, suggestionHeight: 0),
            composerCardHeight(inputHeight: 74)
        )
        XCTAssertEqual(
            composerContentHeight(inputHeight: 74, suggestionHeight: 132),
            composerCardHeight(inputHeight: 74) + 132 - composerHistoryPanelOverlap
        )
        XCTAssertEqual(composerContentHeight(inputHeight: 74, suggestionHeight: 132), 290)
        XCTAssertEqual(
            composerContentHeight(inputHeight: 74, suggestionHeight: 2),
            composerCardHeight(inputHeight: 74)
        )
    }

    func testWindowOriginKeepsContentAtComposerPosition() {
        let visible = CGRect(x: 0, y: 0, width: 1440, height: 875)
        let contentSize = CGSize(width: 680, height: 164)

        let origin = composerWindowOrigin(
            visibleFrame: visible,
            contentSize: contentSize,
            shadowInset: 28
        )
        let card = CGRect(
            x: origin.x + 28,
            y: origin.y + 28,
            width: contentSize.width,
            height: contentSize.height
        )

        XCTAssertEqual(origin.x, 352)
        XCTAssertEqual(origin.y, 77)
        XCTAssertEqual(card.midX, visible.midX)
        XCTAssertEqual(card.minY, 105, accuracy: 0.001)
        XCTAssertTrue(visible.contains(card))
    }

    func testZeroInsetMatchesContentOrigin() {
        let visible = CGRect(x: -1920, y: -25, width: 1920, height: 1055)
        let contentSize = CGSize(width: 680, height: 218)

        let origin = composerWindowOrigin(
            visibleFrame: visible,
            contentSize: contentSize,
            shadowInset: 0
        )
        let content = composerOrigin(visibleFrame: visible, panelSize: contentSize)

        XCTAssertEqual(origin.x, content.x)
        XCTAssertEqual(origin.y, content.y)
    }

    func testWindowOriginOnNegativeOriginScreenKeepsCardVisible() {
        let visible = CGRect(x: -1920, y: -25, width: 1920, height: 1055)
        let contentSize = CGSize(width: 680, height: 218)

        let origin = composerWindowOrigin(
            visibleFrame: visible,
            contentSize: contentSize,
            shadowInset: 28
        )
        let card = CGRect(
            x: origin.x + 28,
            y: origin.y + 28,
            width: contentSize.width,
            height: contentSize.height
        )

        XCTAssertTrue(visible.contains(card))
    }
}