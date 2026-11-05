import AppKit
import PanelizeSearchCore

final class SendButton: NSButton {
    private(set) var isBusy = false

    var normalImage: NSImage? {
        didSet {
            arrowView.image = normalImage
            refreshAppearance(animated: false)
        }
    }

    private let spinner = NSProgressIndicator()
    private let arrowView = NSImageView()
    private var isHovered = false
    private var isPressed = false
    private var trackingArea: NSTrackingArea?
    private var showingSpinner = false
    private var contentRevision = 0

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        isBordered = false
        title = ""
        alternateTitle = ""
        wantsLayer = true
        focusRingType = .none
        layer?.masksToBounds = true

        arrowView.imageScaling = .scaleProportionallyUpOrDown
        arrowView.translatesAutoresizingMaskIntoConstraints = false
        arrowView.setAccessibilityElement(false)
        arrowView.isHidden = true
        addSubview(arrowView)

        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isDisplayedWhenStopped = false
        spinner.setAccessibilityElement(false)
        spinner.translatesAutoresizingMaskIntoConstraints = false
        addSubview(spinner)

        NSLayoutConstraint.activate([
            arrowView.centerXAnchor.constraint(equalTo: centerXAnchor),
            arrowView.centerYAnchor.constraint(equalTo: centerYAnchor),
            arrowView.widthAnchor.constraint(equalToConstant: 14),
            arrowView.heightAnchor.constraint(equalToConstant: 14),
            spinner.centerXAnchor.constraint(equalTo: centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: centerYAnchor),
            spinner.widthAnchor.constraint(equalToConstant: ComposerMetrics.progressSize),
            spinner.heightAnchor.constraint(equalToConstant: ComposerMetrics.progressSize)
        ])
        spinner.isHidden = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    /// The single path that flips the button between sending and idle, so the
    /// hover/press appearance is always re-applied with the right motion.
    func setSending(_ sending: Bool, animated: Bool = true) {
        guard isBusy != sending else { return }
        isBusy = sending
        isEnabled = !sending
        refreshAppearance(animated: animated)
    }

    override func layout() {
        super.layout()
        layer?.cornerRadius = bounds.height / 2
        layer?.masksToBounds = true
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        refreshAppearance(animated: false)
    }

    /// The arrow and spinner are decoration; every click belongs to the
    /// button so the action never depends on which subview was hit.
    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        return bounds.contains(local) ? self : nil
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let trackingArea {
            removeTrackingArea(trackingArea)
        }
        let area = NSTrackingArea(
            rect: .zero,
            options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(area)
        trackingArea = area
    }

    override func mouseEntered(with event: NSEvent) {
        isHovered = true
        refreshAppearance(animated: true)
    }

    override func mouseExited(with event: NSEvent) {
        isHovered = false
        isPressed = false
        refreshAppearance(animated: true)
    }

    override func mouseDown(with event: NSEvent) {
        isPressed = true
        refreshAppearance(animated: true)
        super.mouseDown(with: event)
        isPressed = false
        refreshAppearance(animated: true)
    }

    func refreshAppearance(animated: Bool = false) {
        wantsLayer = true
        layer?.cornerRadius = bounds.height / 2
        layer?.masksToBounds = true
        let options = ComposerAccessibilityOptions.current
        let active = isEnabled && !isBusy
        let background: NSColor
        if active {
            let accent = NSColor.controlAccentColor
            if isPressed {
                background = accent.blended(withFraction: 0.18, of: .black) ?? accent
            } else if isHovered {
                background = accent.blended(withFraction: 0.10, of: .black) ?? accent
            } else {
                background = accent
            }
        } else {
            background = .quaternaryLabelColor
        }
        let targetScale: CGFloat = active
            ? (isPressed ? ComposerMotion.pressScale
                : (isHovered ? ComposerMotion.hoverScale : 1))
            : 1
        let shouldAnimate = animated && !options.reduceMotion
        applyLayer(
            background: ComposerTheme.resolve(background, in: effectiveAppearance),
            scale: targetScale,
            animated: shouldAnimate
        )
        animateAlpha(isBusy ? 0.90 : 1, animated: shouldAnimate)
        updateContent(animated: shouldAnimate)
    }

    private func applyLayer(background: CGColor, scale: CGFloat, animated: Bool) {
        guard let layer else { return }
        let transform = CATransform3DMakeScale(scale, scale, 1)
        if animated {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = isPressed
                    ? ComposerMotion.pressDuration
                    : ComposerMotion.hoverDuration
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                context.allowsImplicitAnimation = true
                layer.backgroundColor = background
                layer.transform = transform
            }
        } else {
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            layer.backgroundColor = background
            layer.transform = transform
            CATransaction.commit()
        }
    }

    /// Implicit layer animation does not cover NSView properties, so alpha
    /// goes through the animator proxy.
    private func animateAlpha(_ target: CGFloat, animated: Bool) {
        guard abs(alphaValue - target) > 0.001 else { return }
        guard animated else {
            alphaValue = target
            return
        }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = ComposerMotion.hoverDuration
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            animator().alphaValue = target
        }
    }

    private func updateContent(animated: Bool) {
        let options = ComposerAccessibilityOptions.current
        if isBusy {
            setAccessibilityLabel("正在发送…")
            toolTip = "正在发送…"
        } else {
            setAccessibilityLabel("发送给所有 AI")
            toolTip = "发送给所有 AI（Enter）"
        }

        if isBusy && options.reduceMotion {
            spinner.stopAnimation(nil)
            arrowView.image = NSImage(
                systemSymbolName: "ellipsis",
                accessibilityDescription: nil
            )?.withSymbolConfiguration(
                NSImage.SymbolConfiguration(pointSize: 11, weight: .semibold)
            )
            arrowView.contentTintColor = .tertiaryLabelColor
            applyContentVisibility(spinnerVisible: false, arrowVisible: true, animated: false)
            return
        }

        if !isBusy {
            spinner.stopAnimation(nil)
            arrowView.image = normalImage
            arrowView.contentTintColor = isEnabled ? .white : .tertiaryLabelColor
        }
        applyContentVisibility(spinnerVisible: isBusy, arrowVisible: !isBusy, animated: animated)
    }

    private func applyContentVisibility(
        spinnerVisible: Bool,
        arrowVisible: Bool,
        animated: Bool
    ) {
        let changed = spinnerVisible != showingSpinner
        showingSpinner = spinnerVisible
        guard changed || !animated else { return }

        if spinnerVisible {
            if spinner.isHidden {
                spinner.alphaValue = 0
            }
            spinner.isHidden = false
            spinner.startAnimation(nil)
        }
        if arrowVisible {
            if arrowView.isHidden {
                arrowView.alphaValue = 0
            }
            arrowView.isHidden = false
        }

        guard animated else {
            spinner.alphaValue = spinnerVisible ? 1 : 0
            spinner.isHidden = !spinnerVisible
            if !spinnerVisible {
                spinner.stopAnimation(nil)
            }
            arrowView.alphaValue = arrowVisible ? 1 : 0
            arrowView.isHidden = !arrowVisible
            return
        }

        contentRevision += 1
        let revision = contentRevision
        NSAnimationContext.runAnimationGroup { context in
            context.duration = ComposerMotion.crossfadeDuration
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            spinner.animator().alphaValue = spinnerVisible ? 1 : 0
            arrowView.animator().alphaValue = arrowVisible ? 1 : 0
        } completionHandler: { [weak self] in
            guard let self, self.contentRevision == revision else { return }
            spinner.isHidden = !spinnerVisible
            if !spinnerVisible {
                spinner.stopAnimation(nil)
            }
            arrowView.isHidden = !arrowVisible
        }
    }
}
