import AppKit

/// Keeps the floating panel draggable from its empty background without
/// interfering with the text view and controls above it.
final class ComposerContentView: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
}

/// The window's content view. The composer card is inset to leave room for the
/// custom shadow; clicks in that transparent margin dismiss the panel.
final class ComposerRootView: NSView {
    /// The card and the history panel above it. Their union includes the gap
    /// between them, so clicks there drag rather than dismiss the composer.
    var cardViews: [NSView] = []
    var onOutsideClick: (() -> Void)?

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        let frames = cardViews.filter { !$0.isHidden }.map(\.frame)
        let region = frames.dropFirst().reduce(frames.first ?? .zero) { $0.union($1) }
        if region.contains(point) {
            window?.performDrag(with: event)
        } else {
            onOutsideClick?()
        }
    }

    override var mouseDownCanMoveWindow: Bool { false }
}

/// A transparent layer that only renders the card's soft shadow. It never
/// receives clicks and does not affect the visual effect view above it.
final class ComposerShadowView: NSView {
    private let cornerRadius: CGFloat
    private let shadowRadius: CGFloat
    private let shadowOffsetY: CGFloat

    init(
        frame frameRect: NSRect = .zero,
        cornerRadius: CGFloat = ComposerMetrics.cornerRadius,
        shadowRadius: CGFloat = ComposerMetrics.shadowRadius,
        shadowOffsetY: CGFloat = ComposerMetrics.shadowOffsetY
    ) {
        self.cornerRadius = cornerRadius
        self.shadowRadius = shadowRadius
        self.shadowOffsetY = shadowOffsetY
        super.init(frame: frameRect)
        wantsLayer = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layout() {
        super.layout()
        updateShadow()
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        updateShadow()
    }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override var mouseDownCanMoveWindow: Bool { false }

    func refreshAppearance() {
        updateShadow()
    }

    private func updateShadow() {
        guard let layer else { return }
        let options = ComposerAccessibilityOptions.current
        layer.shadowColor = ComposerTheme.resolve(
            ComposerTheme.shadowColor(
                in: effectiveAppearance,
                increaseContrast: options.increaseContrast
            ),
            in: effectiveAppearance
        )
        layer.shadowOpacity = 1
        layer.shadowRadius = shadowRadius
        layer.shadowOffset = CGSize(width: 0, height: shadowOffsetY)
        layer.shadowPath = CGPath(
            roundedRect: bounds,
            cornerWidth: cornerRadius,
            cornerHeight: cornerRadius,
            transform: nil
        )
        layer.masksToBounds = false
    }
}

/// The card's surface: a light tint over the material that matches the
/// reference's white input field, or an opaque replacement when the user asks
/// macOS to reduce transparency.
final class ComposerSurfaceView: NSView {
    enum Style {
        case card
        case historyPanel
    }

    private let style: Style

    init(frame frameRect: NSRect = .zero, style: Style = .card) {
        self.style = style
        super.init(frame: frameRect)
        wantsLayer = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layout() {
        super.layout()
        updateAppearance()
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        updateAppearance()
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        updateAppearance()
    }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override var mouseDownCanMoveWindow: Bool { false }

    func refreshAppearance() {
        updateAppearance()
    }

    private func updateAppearance() {
        guard let layer else { return }
        let options = ComposerAccessibilityOptions.current
        layer.cornerRadius = style == .card
            ? ComposerMetrics.cornerRadius
            : ComposerMetrics.historyPanelCornerRadius
        layer.cornerCurve = .continuous
        layer.masksToBounds = true
        layer.borderWidth = 1 / (window?.backingScaleFactor ?? 2)
        effectiveAppearance.performAsCurrentDrawingAppearance {
            let background: NSColor
            if options.reduceTransparency {
                background = style == .card ? .windowBackgroundColor : .controlBackgroundColor
            } else if ComposerTheme.isDark(effectiveAppearance) {
                background = style == .card
                    ? NSColor.white.withAlphaComponent(0.05)
                    : NSColor.black.withAlphaComponent(0.12)
            } else {
                background = style == .card
                    ? NSColor.white.withAlphaComponent(0.70)
                    : NSColor.black.withAlphaComponent(0.05)
            }
            layer.backgroundColor = background.cgColor
            layer.borderColor = ComposerTheme.borderColor(
                in: effectiveAppearance,
                increaseContrast: options.increaseContrast
            ).cgColor
        }
    }
}

/// A light, borderless shortcut legend at the right of the footer.
final class ShortcutHintView: NSView {
    private struct Item {
        let key: String
        let label: String
    }

    private let items = [
        Item(key: "↵", label: "发送"),
        Item(key: "⇧↵", label: "换行"),
        Item(key: "Tab", label: "切换模式"),
        Item(key: "esc", label: "关闭")
    ]

    override var isFlipped: Bool { true }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setAccessibilityElement(true)
        setAccessibilityRole(.staticText)
        setAccessibilityLabel("Enter 发送，Shift+Enter 换行，Tab 切换模式，Esc 关闭")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override var mouseDownCanMoveWindow: Bool { false }

    override var intrinsicContentSize: NSSize {
        NSSize(width: measuredWidth(), height: ComposerMetrics.hintKeycapHeight)
    }

    func refreshAppearance() {
        needsDisplay = true
        invalidateIntrinsicContentSize()
    }

    override func draw(_ dirtyRect: NSRect) {
        let options = ComposerAccessibilityOptions.current
        let color = ComposerTheme.hintColor(increaseContrast: options.increaseContrast)
        let keyAttributes: [NSAttributedString.Key: Any] = [
            .font: ComposerFonts.hintKey,
            .foregroundColor: color
        ]
        let labelAttributes: [NSAttributedString.Key: Any] = [
            .font: ComposerFonts.hint,
            .foregroundColor: color
        ]
        var x: CGFloat = 0

        for item in items {
            let keySize = (item.key as NSString).size(withAttributes: keyAttributes)
            let keyRect = NSRect(
                x: x,
                y: (bounds.height - keySize.height) / 2,
                width: keySize.width,
                height: keySize.height
            )
            (item.key as NSString).draw(in: keyRect, withAttributes: keyAttributes)
            x = keyRect.maxX + ComposerMetrics.hintItemSpacing

            let labelSize = (item.label as NSString).size(withAttributes: labelAttributes)
            let labelRect = NSRect(
                x: x,
                y: (bounds.height - labelSize.height) / 2,
                width: labelSize.width,
                height: labelSize.height
            )
            (item.label as NSString).draw(in: labelRect, withAttributes: labelAttributes)
            x = labelRect.maxX + ComposerMetrics.hintGroupSpacing
        }
    }

    private func measuredWidth() -> CGFloat {
        let keyAttributes: [NSAttributedString.Key: Any] = [.font: ComposerFonts.hintKey]
        let labelAttributes: [NSAttributedString.Key: Any] = [.font: ComposerFonts.hint]
        var width: CGFloat = 0
        for item in items {
            let keyWidth = (item.key as NSString).size(withAttributes: keyAttributes).width
            let labelWidth = (item.label as NSString).size(withAttributes: labelAttributes).width
            width += keyWidth + ComposerMetrics.hintItemSpacing + labelWidth
            width += ComposerMetrics.hintGroupSpacing
        }
        return max(0, width - ComposerMetrics.hintGroupSpacing)
    }
}

/// A small SF Symbol status indicator. The shape carries the state in addition
/// to the color, so the footer does not rely on color alone.
final class StatusIconView: NSImageView {
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        imageScaling = .scaleProportionallyUpOrDown
        setAccessibilityElement(false)
        setAccessibilityRole(.image)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var mouseDownCanMoveWindow: Bool { false }

    func update(symbolName: String, color: NSColor, accessibilityLabel: String?) {
        let configuration = NSImage.SymbolConfiguration(pointSize: 9, weight: .semibold)
        image = NSImage(
            systemSymbolName: symbolName,
            accessibilityDescription: nil
        )?.withSymbolConfiguration(configuration)
        contentTintColor = color
        if let accessibilityLabel {
            setAccessibilityElement(true)
            setAccessibilityLabel(accessibilityLabel)
        } else {
            setAccessibilityElement(false)
        }
    }
}