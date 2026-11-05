import AppKit
import PanelizeSearchCore

final class PromptTextView: NSTextView {
    var onEnter: (() -> Void)?
    var onEscape: (() -> Void)?
    var onTabCompletion: (() -> Bool)?
    var onCyclePromptMode: ((_ forward: Bool) -> Void)?
    var onArrowUp: (() -> Bool)?
    var onArrowDown: (() -> Bool)?

    /// Standard editing shortcuts also work without an Edit menu, which keeps
    /// the accessory app's menu bar optional while the composer is visible.
    @objc func undo(_ sender: Any?) {
        undoManager?.undo()
    }

    @objc func redo(_ sender: Any?) {
        undoManager?.redo()
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection([.command, .shift, .option, .control])
        guard let key = event.charactersIgnoringModifiers?.lowercased() else {
            return super.performKeyEquivalent(with: event)
        }
        if flags == .command {
            switch key {
            case "a":
                selectAll(nil)
                return true
            case "c":
                copy(nil)
                return true
            case "v":
                paste(nil)
                return true
            case "x":
                cut(nil)
                return true
            case "z":
                undoManager?.undo()
                return true
            default:
                break
            }
        } else if flags == [.command, .shift], key == "z" {
            undoManager?.redo()
            return true
        }
        return super.performKeyEquivalent(with: event)
    }

    override func keyDown(with event: NSEvent) {
        // The history list above the input takes the arrows while it shows.
        if (event.keyCode == 126 || event.keyCode == 125),
           event.modifierFlags.intersection([.shift, .control, .option, .command]).isEmpty,
           !hasMarkedText() {
            let handled = event.keyCode == 126 ? onArrowUp?() : onArrowDown?()
            if handled == true {
                return
            }
        }

        if event.keyCode == 48,
           event.modifierFlags.intersection([.control, .option, .command]).isEmpty,
           !hasMarkedText() {
            // An inline trigger completion wins. Otherwise Tab cycles the
            // prompt mode only while the input is empty, Shift+Tab backwards;
            // with text present it leaves the prompt untouched.
            let shift = event.modifierFlags.contains(.shift)
            if !shift, onTabCompletion?() == true {
                return
            }
            if string.isEmpty {
                onCyclePromptMode?(!shift)
            }
            return
        }

        if event.keyCode == 53,
           !event.modifierFlags.contains(.shift),
           !hasMarkedText() {
            onEscape?()
            return
        }

        if event.keyCode == 36 || event.keyCode == 76 {
            if event.modifierFlags.contains(.shift) || hasMarkedText() {
                super.keyDown(with: event)
                return
            }
            onEnter?()
            return
        }

        super.keyDown(with: event)
    }

    /// The insertion point in the text view's own coordinates. Unlike
    /// firstRect(forCharacterRange:) this is explicit for empty text and the
    /// character after the last glyph, and needs no screen conversion.
    func caretRect(forCharacterIndex index: Int) -> NSRect? {
        guard let layoutManager, let textContainer else { return nil }
        layoutManager.ensureLayout(for: textContainer)

        let text = string as NSString
        let caret = min(max(0, index), text.length)
        let origin = textContainerOrigin
        let lineHeight = layoutManager.defaultLineHeight(
            for: font ?? .systemFont(ofSize: 20, weight: .regular)
        )

        guard text.length > 0 else {
            return NSRect(x: origin.x, y: origin.y, width: 2, height: lineHeight)
        }

        if caret >= text.length {
            let lastCharacter = NSRange(location: text.length - 1, length: 1)
            let lastGlyphs = layoutManager.glyphRange(
                forCharacterRange: lastCharacter,
                actualCharacterRange: nil
            )
            let glyph = max(0, NSMaxRange(lastGlyphs) - 1)
            let line = layoutManager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
            let glyphRect = layoutManager.boundingRect(forGlyphRange: lastGlyphs, in: textContainer)
            return NSRect(
                x: origin.x + glyphRect.maxX,
                y: origin.y + line.minY,
                width: 2,
                height: line.height
            )
        }

        let glyph = layoutManager.glyphIndexForCharacter(at: caret)
        let line = layoutManager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
        let location = layoutManager.location(forGlyphAt: glyph)
        return NSRect(
            x: origin.x + location.x,
            y: origin.y + line.minY,
            width: 2,
            height: line.height
        )
    }
}
