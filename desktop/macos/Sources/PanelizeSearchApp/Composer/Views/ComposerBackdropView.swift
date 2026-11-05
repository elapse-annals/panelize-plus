import AppKit
import PanelizeSearchCore

final class ComposerBackdropView: NSVisualEffectView {
    private let cornerRadius: CGFloat
    private(set) var cardEmphasized = false

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
        updateBorder(animated: false)
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        updateBorder(animated: false)
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        updateBorder(animated: false)
    }

    func refreshAppearance() {
        updateBorder(animated: false)
    }

    func setEmphasized(_ emphasized: Bool, animated: Bool) {
        guard cardEmphasized != emphasized else { return }
        cardEmphasized = emphasized
        updateBorder(animated: animated)
    }

    override var mouseDownCanMoveWindow: Bool { true }

    private func updateBorder(animated: Bool) {
        wantsLayer = true
        guard let layer else { return }
        layer.cornerRadius = cornerRadius
        layer.cornerCurve = .continuous
        layer.masksToBounds = true
        layer.borderWidth = 1 / (window?.backingScaleFactor ?? 2)

        let options = ComposerAccessibilityOptions.current
        let color = ComposerTheme.resolve(
            ComposerTheme.borderColor(
                in: effectiveAppearance,
                increaseContrast: options.increaseContrast,
                emphasized: cardEmphasized
            ),
            in: effectiveAppearance
        )
        if animated && !options.reduceMotion {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = ComposerMotion.cardDuration
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                context.allowsImplicitAnimation = true
                layer.borderColor = color
            }
        } else {
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            layer.borderColor = color
            CATransaction.commit()
        }
    }
}
