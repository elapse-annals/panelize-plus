import AppKit
import PanelizeSearchCore

final class SendButton: NSButton {
    var isBusy = false {
        didSet { refreshAppearance() }
    }

    var normalImage: NSImage? {
        didSet {
            arrowView.image = normalImage
            refreshAppearance()
        }
    }

    private let spinner = NSProgressIndicator()
    private let arrowView = NSImageView()
    private var isHovered = false
    private var isPressed = false
    private var trackingArea: NSTrackingArea?

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

    override func updateLayer() {
        super.updateLayer()
        refreshAppearance()
    }

    override func layout() {
        super.layout()
        layer?.cornerRadius = bounds.height / 2
        layer?.masksToBounds = true
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        refreshAppearance()
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
        refreshAppearance()
    }

    override func mouseExited(with event: NSEvent) {
        isHovered = false
        isPressed = false
        refreshAppearance()
    }

    override func mouseDown(with event: NSEvent) {
        isPressed = true
        refreshAppearance()
        super.mouseDown(with: event)
        isPressed = false
        refreshAppearance()
    }

    func refreshAppearance() {
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
        layer?.backgroundColor = ComposerTheme.resolve(
            background,
            in: effectiveAppearance
        )
        alphaValue = isBusy ? 0.90 : 1

        if isBusy {
            if options.reduceMotion {
                spinner.stopAnimation(nil)
                spinner.isHidden = true
                arrowView.isHidden = false
                arrowView.image = NSImage(
                    systemSymbolName: "ellipsis",
                    accessibilityDescription: nil
                )?.withSymbolConfiguration(
                    NSImage.SymbolConfiguration(pointSize: 11, weight: .semibold)
                )
                arrowView.contentTintColor = .tertiaryLabelColor
            } else {
                arrowView.isHidden = true
                spinner.isHidden = false
                spinner.startAnimation(nil)
            }
            setAccessibilityLabel("正在发送…")
            toolTip = "正在发送…"
        } else {
            spinner.stopAnimation(nil)
            spinner.isHidden = true
            arrowView.isHidden = false
            arrowView.image = normalImage
            arrowView.contentTintColor = active ? .white : .tertiaryLabelColor
            setAccessibilityLabel("发送给所有 AI")
            toolTip = "发送给所有 AI（Enter）"
        }
    }
}
