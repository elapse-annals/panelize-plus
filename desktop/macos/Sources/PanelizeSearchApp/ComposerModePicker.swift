import AppKit
import PanelizeSearchCore

/// Resolves a mode's semantic symbol, falling back to the picker's original
/// sparkles when the running system does not provide it.
private func modeSymbolImage(
    for choice: PromptModeChoice,
    configuration: NSImage.SymbolConfiguration
) -> NSImage? {
    let image = NSImage(systemSymbolName: choice.symbolName, accessibilityDescription: nil)
        ?? NSImage(
            systemSymbolName: PromptModeChoice.fallbackSymbolName,
            accessibilityDescription: nil
        )
    return image?.withSymbolConfiguration(configuration)
}

/// A capsule prompt-mode picker. It keeps the native menu behavior and
/// persistence while matching the composer's Spotlight-style controls.
final class ModePickerButton: NSButton {
    var onSelect: ((PromptModeChoice) -> Void)?

    private(set) var selectedChoice: PromptModeChoice = .auto

    private let textPadding: CGFloat = 12
    private let iconSize: CGFloat = 11
    private let iconGap: CGFloat = 5
    private let chevronWidth: CGFloat = 9
    private let chevronPadding: CGFloat = 12
    private let chevronGap: CGFloat = 4

    private var isHovered = false
    private var isPressed = false
    private var trackingArea: NSTrackingArea?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        isBordered = false
        wantsLayer = true
        focusRingType = .default
        setAccessibilityRole(.popUpButton)
        setAccessibilityLabel("提示词模式")
        target = self
        action = #selector(activate)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var intrinsicContentSize: NSSize {
        let titleSize = (selectedChoice.title as NSString).size(
            withAttributes: [.font: ComposerFonts.mode]
        )
        let width = ceil(titleSize.width)
            + textPadding + iconSize + iconGap + chevronGap + chevronWidth + chevronPadding
        return NSSize(
            width: max(64, width),
            height: ComposerMetrics.modePickerHeight
        )
    }

    override func layout() {
        super.layout()
        layer?.cornerRadius = bounds.height / 2
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
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
        needsDisplay = true
    }

    override func mouseExited(with event: NSEvent) {
        isHovered = false
        isPressed = false
        needsDisplay = true
    }

    override func mouseDown(with event: NSEvent) {
        isPressed = true
        needsDisplay = true
        super.mouseDown(with: event)
        isPressed = false
        needsDisplay = true
    }

    override var focusRingMaskBounds: NSRect {
        bounds.insetBy(dx: -2, dy: -2)
    }

    override func drawFocusRingMask() {
        NSBezierPath(
            roundedRect: bounds,
            xRadius: bounds.height / 2,
            yRadius: bounds.height / 2
        ).fill()
    }

    override func draw(_ dirtyRect: NSRect) {
        let enabled = isEnabled
        let path = NSBezierPath(
            roundedRect: bounds,
            xRadius: bounds.height / 2,
            yRadius: bounds.height / 2
        )
        ComposerTheme.controlFill(
            in: effectiveAppearance,
            hovered: isHovered,
            pressed: isPressed,
            enabled: enabled
        ).setFill()
        path.fill()

        let textColor: NSColor
        if !enabled {
            textColor = .tertiaryLabelColor
        } else if isHovered || isPressed {
            textColor = .labelColor
        } else {
            textColor = .secondaryLabelColor
        }
        let attributes: [NSAttributedString.Key: Any] = [
            .font: ComposerFonts.mode,
            .foregroundColor: textColor
        ]
        let iconColor = enabled ? ComposerTheme.accentPurple : NSColor.quaternaryLabelColor
        let iconConfiguration = NSImage.SymbolConfiguration(pointSize: 9, weight: .medium)
            .applying(NSImage.SymbolConfiguration(paletteColors: [iconColor]))
        if let icon = modeSymbolImage(for: selectedChoice, configuration: iconConfiguration) {
            // Symbols differ in aspect ratio; keep each one inside the fixed
            // icon box so the title never shifts between modes.
            let largestSide = max(icon.size.width, icon.size.height)
            let scale = largestSide > 0 ? min(1, iconSize / largestSide) : 1
            let fitSize = NSSize(
                width: icon.size.width * scale,
                height: icon.size.height * scale
            )
            let iconRect = NSRect(
                x: textPadding + (iconSize - fitSize.width) / 2,
                y: bounds.midY - fitSize.height / 2,
                width: fitSize.width,
                height: fitSize.height
            )
            icon.draw(in: iconRect)
        }

        let title = selectedChoice.title as NSString
        let titleSize = title.size(withAttributes: attributes)
        let textX = textPadding + iconSize + iconGap
        let textRect = NSRect(
            x: textX,
            y: (bounds.height - titleSize.height) / 2,
            width: max(
                0,
                bounds.width - textX - chevronGap - chevronWidth - chevronPadding
            ),
            height: titleSize.height
        )
        title.draw(in: textRect, withAttributes: attributes)

        let chevronColor = enabled ? NSColor.tertiaryLabelColor : NSColor.quaternaryLabelColor
        let symbol = NSImage.SymbolConfiguration(pointSize: ComposerFonts.modeChevronPointSize, weight: .semibold)
            .applying(NSImage.SymbolConfiguration(paletteColors: [chevronColor]))
        if let image = NSImage(
            systemSymbolName: "chevron.down",
            accessibilityDescription: nil
        )?.withSymbolConfiguration(symbol) {
            let imageSize = image.size
            let rect = NSRect(
                x: bounds.maxX - chevronPadding - imageSize.width,
                y: bounds.midY - imageSize.height / 2,
                width: imageSize.width,
                height: imageSize.height
            )
            image.draw(in: rect)
        }
    }

    func select(_ choice: PromptModeChoice) {
        selectedChoice = choice
        updateAccessibility()
        invalidateIntrinsicContentSize()
        needsDisplay = true
    }

    func refreshAppearance() {
        needsDisplay = true
    }

    @objc private func activate() {
        guard isEnabled else { return }
        let menu = NSMenu()
        menu.autoenablesItems = false
        for choice in PromptModeChoice.allCases {
            let item = NSMenuItem(
                title: choice.title,
                action: #selector(menuItemSelected(_:)),
                keyEquivalent: ""
            )
            item.target = self
            item.representedObject = choice.rawValue
            item.toolTip = choice.detail
            item.state = choice == selectedChoice ? .on : .off
            if let image = modeSymbolImage(
                for: choice,
                configuration: NSImage.SymbolConfiguration(pointSize: 13, weight: .regular)
            ) {
                image.isTemplate = true
                item.image = image
            }
            if #available(macOS 27.0, *) {
                item.preferredImageVisibility = .visible
            }
            menu.addItem(item)
            if choice == .auto {
                menu.addItem(.separator())
            }
        }
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: bounds.minY - 6), in: self)
    }

    @objc private func menuItemSelected(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String,
              let choice = PromptModeChoice(rawValue: raw) else {
            return
        }
        onSelect?(choice)
    }

    private func updateAccessibility() {
        let switchHint = "按 Tab / Shift+Tab 切换模式"
        setAccessibilityValue(selectedChoice.title)
        setAccessibilityHelp("\(selectedChoice.detail)；\(switchHint)")
        toolTip = "提示词模式：\(selectedChoice.title)（\(selectedChoice.detail)），\(switchHint)"
    }
}