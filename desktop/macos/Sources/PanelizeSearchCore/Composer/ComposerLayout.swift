import CoreGraphics

/// The composer input keeps its initial height until the text needs more than
/// about three lines, then grows up to five lines before scrolling.
public let composerBaseInputHeight: CGFloat = 74
public let composerMaxInputHeight: CGFloat = 128
public let composerBaseContentHeight: CGFloat = 180

// Recent-question rows above the input. At most three are shown.
public let composerSuggestionRowHeight: CGFloat = 28
public let composerSuggestionVerticalPadding: CGFloat = 5
public let composerSuggestionRowSpacing: CGFloat = 2
public let composerSuggestionMaxRows = 3

// The recent questions sit flush above the composer card as their own panel,
// tucked behind it so the card overlaps the panel's bottom padding.
public let composerHistoryHeaderHeight: CGFloat = 18
public let composerHistoryHeaderGap: CGFloat = 4
public let composerHistoryPanelPadding: CGFloat = 6
public let composerHistoryPanelOverlap: CGFloat = 6

public func composerInputHeight(forTextHeight textHeight: CGFloat) -> CGFloat {
    min(max(ceil(textHeight), composerBaseInputHeight), composerMaxInputHeight)
}

public func composerSuggestionHeight(rowCount: Int) -> CGFloat {
    let rows = max(0, min(rowCount, composerSuggestionMaxRows))
    guard rows > 0 else { return 0 }
    return composerSuggestionVerticalPadding * 2
        + CGFloat(rows) * composerSuggestionRowHeight
        + CGFloat(rows - 1) * composerSuggestionRowSpacing
}

/// The full height of the floating history panel, including its title header.
public func composerHistoryPanelHeight(rowCount: Int) -> CGFloat {
    guard min(rowCount, composerSuggestionMaxRows) > 0 else { return 0 }
    return composerHistoryPanelPadding * 2
        + composerHistoryHeaderHeight
        + composerHistoryHeaderGap
        + composerSuggestionHeight(rowCount: rowCount)
}

/// The composer card on its own, without the history panel above it.
public func composerCardHeight(inputHeight: CGFloat) -> CGFloat {
    composerBaseContentHeight + max(0, inputHeight - composerBaseInputHeight)
}

public func composerContentHeight(inputHeight: CGFloat, suggestionHeight: CGFloat = 0) -> CGFloat {
    let visibleHistory = suggestionHeight > 0
        ? max(0, suggestionHeight - composerHistoryPanelOverlap)
        : 0
    return composerCardHeight(inputHeight: inputHeight) + visibleHistory
}

/// Positions a window whose transparent shadow margin surrounds a centered
/// composer card. The card, not the window, keeps the 12% bottom position.
public func composerWindowOrigin(
    visibleFrame: CGRect,
    contentSize: CGSize,
    shadowInset: CGFloat
) -> CGPoint {
    let content = composerOrigin(visibleFrame: visibleFrame, panelSize: contentSize)
    return CGPoint(x: content.x - shadowInset, y: content.y - shadowInset)
}