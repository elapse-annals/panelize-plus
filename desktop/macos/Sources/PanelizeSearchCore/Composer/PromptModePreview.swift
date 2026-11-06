import Foundation

/// The trigger word being typed at the caret, offered for Tab completion.
public struct PromptTriggerCompletion: Equatable {
    /// The canonical built-in trigger, e.g. "/study".
    public let trigger: String
    /// The part of the trigger still missing, e.g. "udy".
    public let rest: String
    /// The mode the completed trigger selects.
    public let mode: PromptModeChoice
    /// The typed token's range in the whole input, in UTF-16 offsets.
    public let range: NSRange
    /// The token exactly as typed, e.g. "/ST".
    public let typed: String
}

/// The faint line under the macOS composer: a local copy of what the selected
/// prompt mode will append, mirroring the extension's prompt ghost. Mode
/// definitions are generated from the extension's prompt modes via
/// scripts/sync-desktop-prompts.js to ensure a single source of truth.
public enum PromptModePreview {
    /// Auto's fallback hint when the question contains no trigger word. The
    /// trigger names follow the extension's menu order.
    public static func triggerLegend(in language: PromptTextLanguage = .current) -> String {
        PromptModeDefinitions.autoTriggerLegend.text(in: language)
    }

    /// Auto's fallback hint in the current system language.
    public static var autoTriggerLegend: String {
        triggerLegend()
    }

    /// The preview for one mode and the current question. `nil` hides the
    /// preview (Default); Auto shows the matched modes' instructions, or the
    /// trigger legend when nothing matches.
    public static func text(
        for choice: PromptModeChoice,
        input: String = "",
        language: PromptTextLanguage = .current
    ) -> String? {
        switch choice {
        case .defaultMode:
            return nil
        case .auto:
            let matched = matchedModes(in: input)
            guard !matched.isEmpty else { return triggerLegend(in: language) }
            return matched.compactMap { instruction(for: $0, in: language) }.joined(separator: " ")
        default:
            return instruction(for: choice, in: language)
        }
    }

    /// The instruction one built-in mode appends, in the requested language.
    public static func instruction(
        for choice: PromptModeChoice,
        in language: PromptTextLanguage = .current
    ) -> String? {
        PromptModeDefinitions.instructions[choice]?.text(in: language)
    }

    /// The trigger word being typed at `caret`, for Tab completion. Mirrors the
    /// extension's `findPromptTriggerCompletion`: only at the end of a line, only
    /// after an allowed boundary, and only for a longer built-in trigger.
    public static func completion(in input: String, caret: Int) -> PromptTriggerCompletion? {
        let text = input as NSString
        guard caret >= 0, caret <= text.length else { return nil }
        if caret < text.length, text.character(at: caret) != 0x0A {
            return nil
        }

        let prefix = text.substring(to: caret) as NSString
        guard let regex = triggerTokenRegex,
              let match = regex.firstMatch(
                in: prefix as String,
                range: NSRange(location: 0, length: prefix.length)
              ) else {
            return nil
        }

        let typed = prefix.substring(with: match.range)
        guard !typed.isEmpty else { return nil }
        let typedKey = typed.lowercased()
        for mode in modesInMenuOrder {
            for trigger in triggers[mode, default: []] {
                guard trigger.count > typed.count,
                      trigger.lowercased().hasPrefix(typedKey) else { continue }
                return PromptTriggerCompletion(
                    trigger: trigger,
                    rest: String(trigger.dropFirst(typed.count)),
                    mode: mode,
                    range: match.range,
                    typed: typed
                )
            }
        }
        return nil
    }

    private static let triggerTokenRegex = try? NSRegularExpression(
        // `\z` (end of input) instead of `$`: ICU's `$` also matches before a
        // trailing newline, which the extension's JavaScript does not.
        pattern: "(?<![A-Za-z0-9_/.:@%~#&=+\\-])/[^\\s/]+\\z"
    )

    /// Built-in modes whose trigger words appear in `input`, in menu order.
    /// Each mode appears once even when several of its triggers match.
    public static func matchedModes(in input: String) -> [PromptModeChoice] {
        modesInMenuOrder.filter { choice in
            triggers[choice, default: []].contains { containsTrigger($0, in: input) }
        }
    }

    public static let modesInMenuOrder: [PromptModeChoice] = PromptModeDefinitions.modesInMenuOrder

    public static let triggers: [PromptModeChoice: [String]] = PromptModeDefinitions.triggers

    public static let instructions: [PromptModeChoice: PromptModeText] = PromptModeDefinitions.instructions

    // Whole-word matching mirrors modules/prompt-modes.js: a trigger may not
    // follow [A-Za-z0-9_/.:@%~#&=+-] or precede [A-Za-z0-9_/.-].
    private static let blockedBefore = Set(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_/.:@%~#&=+-"
    )
    private static let blockedAfter = Set(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_/.-"
    )

    private static func containsTrigger(_ trigger: String, in text: String) -> Bool {
        guard !text.isEmpty else { return false }
        var searchRange = text.startIndex..<text.endIndex
        while let match = text.range(of: trigger, options: [.caseInsensitive], range: searchRange) {
            let beforeOK = match.lowerBound == text.startIndex
                || !blockedBefore.contains(text[text.index(before: match.lowerBound)])
            let afterOK = match.upperBound == text.endIndex
                || !blockedAfter.contains(text[match.upperBound])
            if beforeOK && afterOK { return true }
            guard match.upperBound < text.endIndex else { break }
            searchRange = match.upperBound..<text.endIndex
        }
        return false
    }
}