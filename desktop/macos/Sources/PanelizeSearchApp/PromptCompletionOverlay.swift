import AppKit
import PanelizeSearchCore

/// The inline ghost completion drawn at the caret: the missing part of a
/// slash trigger plus a shaded "Tab · <mode>" hint. It floats above the text
/// view, ignores clicks, and never becomes part of the prompt.
final class PromptCompletionOverlayView: NSView {
    private var rest = ""
    private var modeTitle = ""
    private var textFont = ComposerFonts.input
    private let modeFont = NSFont.systemFont(ofSize: 11, weight: .regular)

    private var suffixSize = NSSize.zero
    private var capsuleSize = NSSize.zero
    private var keycapSize = NSSize.zero
    private var modeSize = NSSize.zero
    private var showsCapsule = true

    override var isFlipped: Bool { true }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        isHidden = true
        setAccessibilityElement(false)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        nil
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }

    func present(
        _ completion: PromptTriggerCompletion,
        at caretRect: NSRect,
        boundsWidth: CGFloat,
        font: NSFont
    ) {
        rest = completion.rest
        modeTitle = completion.mode.title
        textFont = font

        suffixSize = textSize(rest, font: textFont)
        let options = ComposerAccessibilityOptions.current
        keycapSize = KeycapRenderer.size(
            for: "Tab",
            style: ComposerTheme.keycapStyle(increaseContrast: options.increaseContrast)
        )
        modeSize = textSize("· \(modeTitle)", font: modeFont)
        capsuleSize = NSSize(
            width: 5 + keycapSize.width + 5 + modeSize.width + 7,
            height: max(keycapSize.height, modeSize.height) + 6
        )

        let height = max(ceil(suffixSize.height), capsuleSize.height, caretRect.height)
        let fullWidth = suffixSize.width + 6 + capsuleSize.width
        let maxX = boundsWidth - 4
        let originX = caretRect.maxX + 3

        if originX + fullWidth <= maxX {
            showsCapsule = true
            frame = NSRect(
                x: originX,
                y: caretRect.minY + (caretRect.height - height) / 2,
                width: ceil(fullWidth),
                height: ceil(height)
            )
        } else if originX + suffixSize.width <= maxX {
            showsCapsule = false
            frame = NSRect(
                x: originX,
                y: caretRect.minY + (caretRect.height - height) / 2,
                width: ceil(suffixSize.width),
                height: ceil(height)
            )
        } else {
            dismiss()
            return
        }

        if isHidden {
            alphaValue = ComposerAccessibilityOptions.current.reduceMotion ? 1 : 0
        }
        isHidden = false
        needsDisplay = true
        if alphaValue < 1, !ComposerAccessibilityOptions.current.reduceMotion {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.08
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                animator().alphaValue = 1
            }
        } else {
            alphaValue = 1
        }
    }

    func dismiss() {
        isHidden = true
        alphaValue = 1
        rest = ""
        modeTitle = ""
    }

    override func draw(_ dirtyRect: NSRect) {
        guard !rest.isEmpty else { return }

        let suffixAttributes: [NSAttributedString.Key: Any] = [
            .font: textFont,
            .foregroundColor: NSColor.tertiaryLabelColor
        ]
        let suffixRect = NSRect(
            x: 0,
            y: (bounds.height - suffixSize.height) / 2,
            width: suffixSize.width,
            height: suffixSize.height
        )
        (rest as NSString).draw(in: suffixRect, withAttributes: suffixAttributes)

        guard showsCapsule else { return }
        drawCapsule(at: suffixSize.width + 6)
    }

    private func drawCapsule(at x: CGFloat) {
        let capsuleRect = NSRect(
            x: x,
            y: (bounds.height - capsuleSize.height) / 2,
            width: capsuleSize.width,
            height: capsuleSize.height
        )
        let capsulePath = NSBezierPath(roundedRect: capsuleRect, xRadius: 6, yRadius: 6)
        NSColor.labelColor.withAlphaComponent(0.07).setFill()
        capsulePath.fill()
        NSColor.separatorColor.withAlphaComponent(0.55).setStroke()
        capsulePath.lineWidth = 0.5
        capsulePath.stroke()

        let keycapRect = NSRect(
            x: capsuleRect.minX + 5,
            y: capsuleRect.minY + (capsuleRect.height - keycapSize.height) / 2,
            width: keycapSize.width,
            height: keycapSize.height
        )
        let options = ComposerAccessibilityOptions.current
        KeycapRenderer.draw(
            "Tab",
            in: keycapRect,
            style: ComposerTheme.keycapStyle(increaseContrast: options.increaseContrast)
        )

        let modeRect = NSRect(
            x: keycapRect.maxX + 5,
            y: capsuleRect.minY,
            width: modeSize.width,
            height: capsuleRect.height
        )
        drawCentered("· \(modeTitle)", font: modeFont, color: .secondaryLabelColor, in: modeRect)
    }

    private func drawCentered(_ text: String, font: NSFont, color: NSColor, in rect: NSRect) {
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
        let size = textSize(text, font: font)
        let target = NSRect(
            x: rect.midX - size.width / 2,
            y: rect.midY - size.height / 2,
            width: size.width,
            height: size.height
        )
        (text as NSString).draw(in: target, withAttributes: attributes)
    }

    private func textSize(_ text: String, font: NSFont) -> NSSize {
        let size = (text as NSString).size(withAttributes: [.font: font])
        return NSSize(width: ceil(size.width), height: ceil(size.height))
    }
}