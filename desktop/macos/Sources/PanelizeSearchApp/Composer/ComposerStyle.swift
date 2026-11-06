import AppKit

enum ComposerMetrics {
    static let contentWidth: CGFloat = 680
    static let baseContentHeight: CGFloat = 180
    static let baseInputHeight: CGFloat = 74
    static let maxInputHeight: CGFloat = 128

    static let contentInsetLeft: CGFloat = 20
    static let contentInsetRight: CGFloat = 20
    static let contentInsetTop: CGFloat = 17
    static let contentInsetBottom: CGFloat = 13

    static let footerHeight: CGFloat = 46
    static let cornerRadius: CGFloat = 22
    static let shadowInset: CGFloat = 28
    static let shadowRadius: CGFloat = 20
    static let shadowOffsetY: CGFloat = -6

    static let historyPanelCornerRadius: CGFloat = 14
    static let historyPanelShadowRadius: CGFloat = 12
    /// The history panel is narrower than the input card.
    static let historyPanelSideInset: CGFloat = 28

    static let sendButtonSize: CGFloat = 28
    static let progressSize: CGFloat = 14
    static let statusIconSize: CGFloat = 10

    static let modePickerHeight: CGFloat = 22
    static let modePickerCornerRadius: CGFloat = 11
    static let modeHintHeight: CGFloat = 14
    static let modeHintSpacing: CGFloat = 2

    static let hintKeycapHeight: CGFloat = 16
    static let hintItemSpacing: CGFloat = 4
    static let hintGroupSpacing: CGFloat = 10
}

/// Interaction feedback shared by the composer's animated surfaces. Every
/// duration here is skipped when Reduce Motion is on.
enum ComposerMotion {
    static let hoverScale: CGFloat = 1.04
    static let pressScale: CGFloat = 0.94
    static let hoverDuration: CFTimeInterval = 0.16
    static let pressDuration: CFTimeInterval = 0.08
    static let cardDuration: CFTimeInterval = 0.18
    static let crossfadeDuration: CFTimeInterval = 0.12
}

enum ComposerFonts {
    static let input = NSFont.systemFont(ofSize: 20, weight: .regular)
    static let preview = NSFont.systemFont(ofSize: 11.5, weight: .regular)
    static let status = NSFont.systemFont(ofSize: 11, weight: .regular)
    static let hint = NSFont.systemFont(ofSize: 10, weight: .regular)
    static let keycap = NSFont.systemFont(ofSize: 9.5, weight: .semibold)
    static let hintKey = NSFont.systemFont(ofSize: 10, weight: .medium)
    static let mode = NSFont.systemFont(ofSize: 11.5, weight: .medium)
    static let modeHint = NSFont.systemFont(ofSize: 10.5, weight: .regular)
    static let suggestion = NSFont.systemFont(ofSize: 13.5, weight: .regular)
    static let historyHeader = NSFont.systemFont(ofSize: 11, weight: .medium)
    static let modeChevronPointSize: CGFloat = 8
}

struct ComposerAccessibilityOptions {
    let reduceMotion: Bool
    let reduceTransparency: Bool
    let increaseContrast: Bool

    static var current: ComposerAccessibilityOptions {
        let workspace = NSWorkspace.shared
        return ComposerAccessibilityOptions(
            reduceMotion: workspace.accessibilityDisplayShouldReduceMotion,
            reduceTransparency: workspace.accessibilityDisplayShouldReduceTransparency,
            increaseContrast: workspace.accessibilityDisplayShouldIncreaseContrast
        )
    }
}

enum ComposerTheme {
    static let accentPurple = NSColor(
        srgbRed: 0.55,
        green: 0.36,
        blue: 0.96,
        alpha: 1
    )

    static func isDark(_ appearance: NSAppearance) -> Bool {
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    }

    static func resolve(_ color: NSColor, in appearance: NSAppearance) -> CGColor {
        var resolved = color.cgColor
        appearance.performAsCurrentDrawingAppearance {
            resolved = color.cgColor
        }
        return resolved
    }

    static func borderColor(
        in appearance: NSAppearance,
        increaseContrast: Bool,
        emphasized: Bool = false
    ) -> NSColor {
        if isDark(appearance) {
            let alpha: CGFloat = increaseContrast
                ? (emphasized ? 0.44 : 0.35)
                : (emphasized ? 0.26 : 0.18)
            return NSColor.white.withAlphaComponent(alpha)
        }
        let alpha: CGFloat = increaseContrast
            ? (emphasized ? 0.36 : 0.28)
            : (emphasized ? 0.20 : 0.12)
        return NSColor.black.withAlphaComponent(alpha)
    }

    static func shadowColor(in appearance: NSAppearance, increaseContrast: Bool) -> NSColor {
        if isDark(appearance) {
            return NSColor.black.withAlphaComponent(increaseContrast ? 0.66 : 0.55)
        }
        return NSColor.black.withAlphaComponent(increaseContrast ? 0.32 : 0.24)
    }

    static func controlFill(
        in appearance: NSAppearance,
        hovered: Bool,
        pressed: Bool,
        enabled: Bool
    ) -> NSColor {
        guard enabled else {
            return NSColor.labelColor.withAlphaComponent(0.03)
        }
        let alpha: CGFloat = pressed ? 0.14 : (hovered ? 0.10 : 0.06)
        return NSColor.labelColor.withAlphaComponent(alpha)
    }

    static func hintColor(increaseContrast: Bool) -> NSColor {
        increaseContrast ? .labelColor : .tertiaryLabelColor
    }

    static func previewColor(increaseContrast: Bool) -> NSColor {
        increaseContrast ? .secondaryLabelColor : .tertiaryLabelColor
    }

    static func keycapStyle(increaseContrast: Bool) -> KeycapStyle {
        KeycapStyle(
            font: ComposerFonts.keycap,
            textColor: increaseContrast ? .labelColor : .secondaryLabelColor,
            fillColor: NSColor.labelColor.withAlphaComponent(increaseContrast ? 0.14 : 0.08),
            borderColor: NSColor.separatorColor.withAlphaComponent(increaseContrast ? 1 : 0.80),
            cornerRadius: 4,
            horizontalPadding: 5,
            verticalPadding: 2.5,
            borderWidth: increaseContrast ? 1 : 0.5
        )
    }
}

struct KeycapStyle {
    let font: NSFont
    let textColor: NSColor
    let fillColor: NSColor
    let borderColor: NSColor
    let cornerRadius: CGFloat
    let horizontalPadding: CGFloat
    let verticalPadding: CGFloat
    let borderWidth: CGFloat
}

enum KeycapRenderer {
    static func size(for text: String, style: KeycapStyle) -> NSSize {
        let textSize = textSize(text, font: style.font)
        return NSSize(
            width: ceil(textSize.width + style.horizontalPadding * 2),
            height: max(
                ComposerMetrics.hintKeycapHeight,
                ceil(textSize.height + style.verticalPadding * 2)
            )
        )
    }

    static func draw(_ text: String, in rect: NSRect, style: KeycapStyle) {
        let path = NSBezierPath(
            roundedRect: rect.insetBy(dx: style.borderWidth / 2, dy: style.borderWidth / 2),
            xRadius: style.cornerRadius,
            yRadius: style.cornerRadius
        )
        style.fillColor.setFill()
        path.fill()
        style.borderColor.setStroke()
        path.lineWidth = style.borderWidth
        path.stroke()

        let attributes: [NSAttributedString.Key: Any] = [
            .font: style.font,
            .foregroundColor: style.textColor
        ]
        let size = textSize(text, font: style.font)
        let target = NSRect(
            x: rect.midX - size.width / 2,
            y: rect.midY - size.height / 2,
            width: size.width,
            height: size.height
        )
        (text as NSString).draw(in: target, withAttributes: attributes)
    }

    private static func textSize(_ text: String, font: NSFont) -> NSSize {
        let size = (text as NSString).size(withAttributes: [.font: font])
        return NSSize(width: ceil(size.width), height: ceil(size.height))
    }
}