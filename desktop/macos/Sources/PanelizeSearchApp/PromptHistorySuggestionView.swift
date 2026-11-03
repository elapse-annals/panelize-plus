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
        composerSuggestionHeight(rowCount: suggestions.count)
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
        let offset = point.y - composerSuggestionVerticalPadding
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

        let rowWidth = bounds.width - 8
        for (index, question) in suggestions.enumerated() {
            let rowRect = NSRect(
                x: 4,
                y: composerSuggestionVerticalPadding
                    + CGFloat(index) * (composerSuggestionRowHeight + composerSuggestionRowSpacing),
                width: rowWidth,
                height: composerSuggestionRowHeight
            )

            if index == selectedIndex || index == hoveredIndex {
                NSColor.controlAccentColor.withAlphaComponent(0.14).setFill()
                NSBezierPath(roundedRect: rowRect, xRadius: 7, yRadius: 7).fill()
            }

            if index > 0 {
                NSColor.separatorColor.withAlphaComponent(0.45).setFill()
                NSRect(x: rowRect.minX + 8, y: rowRect.minY, width: rowRect.width - 16, height: 1).fill()
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
                x: rowRect.minX + 8,
                y: rowRect.midY - ComposerFonts.suggestion.capHeight / 2 - 1,
                width: rowRect.width - 16,
                height: ComposerFonts.suggestion.pointSize + 4
            )
            text.draw(with: textRect, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
        }
    }
}
