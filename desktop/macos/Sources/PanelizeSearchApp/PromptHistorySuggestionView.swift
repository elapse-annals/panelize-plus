import AppKit
import PanelizeSearchCore

/// The recent questions offered above the composer input. Rows are drawn
/// rather than built from controls so the list stays lightweight and does not
/// take keyboard focus from the text view.
final class PromptHistorySuggestionView: NSView {
    var onSelect: ((Int) -> Void)?

    private(set) var suggestions: [String] = []
    private(set) var selectedIndex: Int?
    private var hoveredIndex: Int?
    private var trackingArea: NSTrackingArea?

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { false }
    override var mouseDownCanMoveWindow: Bool { false }

    var contentHeight: CGFloat {
        composerHistoryPanelHeight(rowCount: suggestions.count)
    }

    /// Rows start below the "最近提问" header.
    private var rowOriginY: CGFloat {
        composerHistoryPanelPadding + composerHistoryHeaderHeight + composerHistoryHeaderGap
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }

    func present(_ questions: [String], selectedIndex: Int?) {
        suggestions = questions
        self.selectedIndex = selectedIndex
        if questions.isEmpty { hoveredIndex = nil }
        isHidden = questions.isEmpty
        needsDisplay = true
    }

    func dismiss() {
        suggestions = []
        selectedIndex = nil
        hoveredIndex = nil
        isHidden = true
        needsDisplay = true
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let trackingArea {
            removeTrackingArea(trackingArea)
        }
        let area = NSTrackingArea(
            rect: bounds,
            options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(area)
        trackingArea = area
    }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: .pointingHand)
    }

    override func mouseMoved(with event: NSEvent) {
        let index = rowIndex(at: convert(event.locationInWindow, from: nil))
        guard index != hoveredIndex else { return }
        hoveredIndex = index
        needsDisplay = true
    }

    override func mouseExited(with event: NSEvent) {
        guard hoveredIndex != nil else { return }
        hoveredIndex = nil
        needsDisplay = true
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        guard let index = rowIndex(at: point), index < suggestions.count else { return }
        onSelect?(index)
    }

    private func rowIndex(at point: NSPoint) -> Int? {
        guard !suggestions.isEmpty else { return nil }
        let offset = point.y - rowOriginY
        guard offset >= 0 else { return nil }
        let stride = composerSuggestionRowHeight + composerSuggestionRowSpacing
        let index = Int(offset / stride)
        guard index >= 0, index < suggestions.count else { return nil }
        let withinRow = offset - CGFloat(index) * stride
        return withinRow <= composerSuggestionRowHeight ? index : nil
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard !suggestions.isEmpty else { return }

        let options = ComposerAccessibilityOptions.current
        let header = "最近提问" as NSString
        let headerAttributes: [NSAttributedString.Key: Any] = [
            .font: ComposerFonts.historyHeader,
            .foregroundColor: options.increaseContrast
                ? NSColor.labelColor
                : NSColor.secondaryLabelColor
        ]
        let headerSize = header.size(withAttributes: headerAttributes)
        let headerRect = NSRect(
            x: 12,
            y: composerHistoryPanelPadding
                + (composerHistoryHeaderHeight - headerSize.height) / 2,
            width: bounds.width - 24,
            height: headerSize.height
        )
        header.draw(in: headerRect, withAttributes: headerAttributes)

        let rowWidth = bounds.width - composerHistoryPanelPadding * 2
        for (index, question) in suggestions.enumerated() {
            let rowRect = NSRect(
                x: composerHistoryPanelPadding,
                y: rowOriginY
                    + CGFloat(index) * (composerSuggestionRowHeight + composerSuggestionRowSpacing),
                width: rowWidth,
                height: composerSuggestionRowHeight
            )

            if index == selectedIndex || index == hoveredIndex {
                NSColor.controlAccentColor.withAlphaComponent(0.14).setFill()
                NSBezierPath(roundedRect: rowRect, xRadius: 8, yRadius: 8).fill()
            }

            let paragraph = NSMutableParagraphStyle()
            paragraph.lineBreakMode = .byTruncatingTail
            let color: NSColor = index == selectedIndex
                ? .labelColor
                : NSColor.labelColor.withAlphaComponent(0.82)
            let text = NSAttributedString(
                string: question.replacingOccurrences(of: "\n", with: " "),
                attributes: [
                    .font: ComposerFonts.suggestion,
                    .foregroundColor: color,
                    .paragraphStyle: paragraph
                ]
            )
            let textRect = NSRect(
                x: rowRect.minX + 6,
                y: rowRect.midY - ComposerFonts.suggestion.capHeight / 2 - 1,
                width: rowRect.width - 12,
                height: ComposerFonts.suggestion.pointSize + 4
            )
            text.draw(with: textRect, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
        }
    }
}
