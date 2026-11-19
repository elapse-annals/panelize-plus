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
        XCTAssertEqual(composerContentHeight(inputHeight: 74), 180)
        XCTAssertEqual(composerContentHeight(inputHeight: 104), 210)
        XCTAssertEqual(composerContentHeight(inputHeight: 128), 234)
    }

    func testContentHeightAddsSuggestionRows() {
        XCTAssertEqual(composerSuggestionHeight(rowCount: 0), 0)
        XCTAssertEqual(composerSuggestionHeight(rowCount: 1), 38)
        XCTAssertEqual(composerSuggestionHeight(rowCount: 3), 98)
        XCTAssertEqual(composerSuggestionHeight(rowCount: 9), 98)
        XCTAssertEqual(composerContentHeight(inputHeight: 74, suggestionHeight: 0), 180)
    }

    func testCardHeightIgnoresTheHistoryPanel() {
        XCTAssertEqual(composerCardHeight(inputHeight: 74), 180)
        XCTAssertEqual(composerCardHeight(inputHeight: 104), 210)
        XCTAssertEqual(composerCardHeight(inputHeight: 128), 234)
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
        XCTAssertEqual(composerContentHeight(inputHeight: 74, suggestionHeight: 132), 306)
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

    func testHistoryBrowserUsesPreferredHeightWhenThereIsRoom() {
        let visible = CGRect(x: 0, y: 0, width: 1440, height: 875)
        let contentOrigin = composerOrigin(
            visibleFrame: visible,
            panelSize: CGSize(width: 680, height: 180)
        )
        let maxHeight = composerHistoryBrowserMaxHeight(
            visibleFrame: visible,
            contentOrigin: contentOrigin,
            cardHeight: composerCardHeight(inputHeight: 74),
            shadowInset: 28
        )
        XCTAssertGreaterThan(maxHeight, composerHistoryBrowserPreferredHeight)
        XCTAssertEqual(
            composerHistoryBrowserHeight(maxAvailable: maxHeight),
            composerHistoryBrowserPreferredHeight
        )
    }

    func testHistoryBrowserShrinksBelowItsMinimumOnASmallScreen() {
        let visible = CGRect(x: 0, y: 0, width: 1440, height: 300)
        let contentOrigin = composerOrigin(
            visibleFrame: visible,
            panelSize: CGSize(width: 680, height: 180)
        )
        let maxHeight = composerHistoryBrowserMaxHeight(
            visibleFrame: visible,
            contentOrigin: contentOrigin,
            cardHeight: composerCardHeight(inputHeight: 74),
            shadowInset: 28
        )
        XCTAssertLessThan(maxHeight, composerHistoryBrowserMinimumHeight)
        let height = composerHistoryBrowserHeight(maxAvailable: maxHeight)
        XCTAssertEqual(height, maxHeight, accuracy: 0.001)

        // The card stays bottom-anchored and the window never leaves the screen.
        let contentHeight = composerContentHeight(inputHeight: 74, suggestionHeight: height)
        let origin = composerWindowOrigin(
            visibleFrame: visible,
            contentSize: CGSize(width: 680, height: contentHeight),
            shadowInset: 28
        )
        XCTAssertLessThanOrEqual(origin.y + contentHeight + 28, visible.maxY + 0.001)
    }

    func testHistoryBrowserHeightIsZeroWithoutRoom() {
        XCTAssertEqual(composerHistoryBrowserHeight(maxAvailable: 0), 0)
        XCTAssertEqual(composerHistoryBrowserHeight(maxAvailable: -20), 0)
        XCTAssertEqual(composerHistoryBrowserHeight(maxAvailable: 0, mode: .zoomed), 0)
        XCTAssertEqual(composerHistoryBrowserHeight(maxAvailable: -20, mode: .zoomed), 0)
    }

    // MARK: - Expanded reading mode

    func testHistoryBrowserPreferredHeightDependsOnMode() {
        XCTAssertEqual(composerHistoryBrowserPreferredHeight(for: .twoColumn), 336)
        XCTAssertEqual(composerHistoryBrowserPreferredHeight(for: .zoomed), 520)
        XCTAssertEqual(composerHistoryBrowserPreferredHeight, 336)
        XCTAssertEqual(composerHistoryBrowserZoomedPreferredHeight, 520)
    }

    func testZoomedBrowserUsesPreferredHeightWhenThereIsRoom() {
        let visible = CGRect(x: 0, y: 0, width: 1440, height: 875)
        let contentOrigin = composerOrigin(
            visibleFrame: visible,
            panelSize: CGSize(width: 680, height: 180)
        )
        let maxHeight = composerHistoryBrowserMaxHeight(
            visibleFrame: visible,
            contentOrigin: contentOrigin,
            cardHeight: composerCardHeight(inputHeight: 74),
            shadowInset: 28
        )
        XCTAssertEqual(maxHeight, 556, accuracy: 0.001)
        XCTAssertEqual(composerHistoryBrowserHeight(maxAvailable: maxHeight), 336)
        XCTAssertEqual(
            composerHistoryBrowserHeight(maxAvailable: maxHeight, mode: .zoomed),
            520
        )
    }

    func testZoomedBrowserShrinksOnASmallScreenAndKeepsTheWindowTopInside() {
        let visible = CGRect(x: 0, y: 0, width: 1440, height: 300)
        let contentOrigin = composerOrigin(
            visibleFrame: visible,
            panelSize: CGSize(width: 680, height: 180)
        )
        let maxHeight = composerHistoryBrowserMaxHeight(
            visibleFrame: visible,
            contentOrigin: contentOrigin,
            cardHeight: composerCardHeight(inputHeight: 74),
            shadowInset: 28
        )
        XCTAssertLessThan(maxHeight, composerHistoryBrowserMinimumUsableHeight)

        let zoomed = composerHistoryBrowserHeight(maxAvailable: maxHeight, mode: .zoomed)
        XCTAssertEqual(zoomed, maxHeight, accuracy: 0.001)

        // The card keeps its bottom edge and the window top stays 12pt under
        // the visible frame's top.
        let contentHeight = composerContentHeight(inputHeight: 74, suggestionHeight: zoomed)
        let origin = composerWindowOrigin(
            visibleFrame: visible,
            contentSize: CGSize(width: 680, height: contentHeight),
            shadowInset: 28
        )
        XCTAssertEqual(origin.y + 28, contentOrigin.y, accuracy: 0.001)
        XCTAssertLessThanOrEqual(
            origin.y + contentHeight + 28,
            visible.maxY - composerHistoryBrowserTopMargin + 0.001
        )
    }

    func testZoomedBrowserClampsAgainstTheDraggedCardBottom() {
        // The user dragged the panel up; the available room is measured from
        // the real bottom edge rather than the designed position.
        let visible = CGRect(x: 0, y: 0, width: 1440, height: 875)
        let contentBottom: CGFloat = 600
        let cardHeight = composerCardHeight(inputHeight: 74)
        let maxHeight = composerHistoryBrowserMaxHeight(
            visibleFrame: visible,
            contentOrigin: CGPoint(x: 0, y: contentBottom),
            cardHeight: cardHeight,
            shadowInset: 28
        )
        XCTAssertEqual(maxHeight, 61, accuracy: 0.001)

        let zoomed = composerHistoryBrowserHeight(maxAvailable: maxHeight, mode: .zoomed)
        XCTAssertEqual(zoomed, 61, accuracy: 0.001)
        let windowTop = contentBottom + cardHeight + (zoomed - composerHistoryPanelOverlap) + 28
        XCTAssertEqual(windowTop, visible.maxY - composerHistoryBrowserTopMargin, accuracy: 0.001)
    }

    func testZoomedBrowserClampsToAPartiallyAvailableScreen() {
        // A medium screen leaves less than the 520pt preference but more than
        // the minimum, so the browser takes exactly what is available.
        let visible = CGRect(x: 0, y: 0, width: 1440, height: 500)
        let contentOrigin = composerOrigin(
            visibleFrame: visible,
            panelSize: CGSize(width: 680, height: 180)
        )
        let maxHeight = composerHistoryBrowserMaxHeight(
            visibleFrame: visible,
            contentOrigin: contentOrigin,
            cardHeight: composerCardHeight(inputHeight: 74),
            shadowInset: 28
        )
        XCTAssertEqual(maxHeight, 226, accuracy: 0.001)
        XCTAssertGreaterThan(maxHeight, composerHistoryBrowserMinimumUsableHeight)
        XCTAssertLessThan(maxHeight, composerHistoryBrowserZoomedPreferredHeight)

        XCTAssertEqual(
            composerHistoryBrowserHeight(maxAvailable: maxHeight, mode: .twoColumn),
            maxHeight,
            accuracy: 0.001
        )
        let zoomed = composerHistoryBrowserHeight(maxAvailable: maxHeight, mode: .zoomed)
        XCTAssertEqual(zoomed, maxHeight, accuracy: 0.001)

        // The card bottom stays put and the window top stops 12pt below the
        // visible frame.
        let contentHeight = composerContentHeight(inputHeight: 74, suggestionHeight: zoomed)
        let origin = composerWindowOrigin(
            visibleFrame: visible,
            contentSize: CGSize(width: 680, height: contentHeight),
            shadowInset: 28
        )
        XCTAssertEqual(origin.y + 28, contentOrigin.y, accuracy: 0.001)
        XCTAssertLessThanOrEqual(
            origin.y + contentHeight + 28,
            visible.maxY - composerHistoryBrowserTopMargin + 0.001
        )
    }

    func testZoomedBrowserOnANegativeOriginScreen() {
        let visible = CGRect(x: -1920, y: -25, width: 1920, height: 1055)
        let contentOrigin = composerOrigin(
            visibleFrame: visible,
            panelSize: CGSize(width: 680, height: 180)
        )
        let maxHeight = composerHistoryBrowserMaxHeight(
            visibleFrame: visible,
            contentOrigin: contentOrigin,
            cardHeight: composerCardHeight(inputHeight: 74),
            shadowInset: 28
        )
        XCTAssertGreaterThan(maxHeight, composerHistoryBrowserZoomedPreferredHeight)

        let zoomed = composerHistoryBrowserHeight(maxAvailable: maxHeight, mode: .zoomed)
        XCTAssertEqual(zoomed, composerHistoryBrowserZoomedPreferredHeight)

        let contentHeight = composerContentHeight(inputHeight: 74, suggestionHeight: zoomed)
        let origin = composerWindowOrigin(
            visibleFrame: visible,
            contentSize: CGSize(width: 680, height: contentHeight),
            shadowInset: 28
        )
        XCTAssertLessThanOrEqual(
            origin.y + contentHeight + 28,
            visible.maxY - composerHistoryBrowserTopMargin + 0.001
        )
        XCTAssertEqual(origin.y + 28, contentOrigin.y, accuracy: 0.001)
    }

    func testSystemRepositionUsesTheTargetBottomForZoomedHeight() {
        // After a screen change the panel returns to the designed position, so
        // the browser must be measured from that target, not its old frame.
        let visible = CGRect(x: 0, y: 0, width: 1440, height: 875)
        let targetOrigin = composerOrigin(
            visibleFrame: visible,
            panelSize: CGSize(width: 680, height: 180)
        )
        let maxHeight = composerHistoryBrowserMaxHeight(
            visibleFrame: visible,
            contentOrigin: CGPoint(x: 0, y: targetOrigin.y),
            cardHeight: composerCardHeight(inputHeight: 74),
            shadowInset: 28
        )
        XCTAssertEqual(
            composerHistoryBrowserHeight(maxAvailable: maxHeight, mode: .zoomed),
            520
        )
    }
}