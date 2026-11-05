import AppKit
import PanelizeSearchCore

final class StatusStackView: NSStackView {
    var isActionable = false {
        didSet {
            guard oldValue != isActionable else { return }
            window?.invalidateCursorRects(for: self)
        }
    }

    override func resetCursorRects() {
        super.resetCursorRects()
        if isActionable {
            addCursorRect(bounds, cursor: .pointingHand)
        }
    }
}
