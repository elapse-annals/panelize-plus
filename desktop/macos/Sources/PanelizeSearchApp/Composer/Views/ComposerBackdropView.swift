import AppKit
import PanelizeSearchCore

final class ComposerBackdropView: NSVisualEffectView {
    private let cornerRadius: CGFloat

    init(frame frameRect: NSRect = .zero, cornerRadius: CGFloat = ComposerMetrics.cornerRadius) {
        self.cornerRadius = cornerRadius
        super.init(frame: frameRect)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layout() {
        super.layout()
        updateBorder()
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        updateBorder()
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        updateBorder()
    }

    func refreshAppearance() {
        updateBorder()
    }

    override var mouseDownCanMoveWindow: Bool { true }

    private func updateBorder() {
        wantsLayer = true
        layer?.cornerRadius = cornerRadius
        layer?.cornerCurve = .continuous
        layer?.masksToBounds = true
        layer?.borderWidth = 1 / (window?.backingScaleFactor ?? 2)

        let options = ComposerAccessibilityOptions.current
        layer?.borderColor = ComposerTheme.resolve(
            ComposerTheme.borderColor(
                in: effectiveAppearance,
                increaseContrast: options.increaseContrast
            ),
            in: effectiveAppearance
        )
    }
}
