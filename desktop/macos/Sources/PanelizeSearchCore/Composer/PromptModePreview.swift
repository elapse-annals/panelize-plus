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
/// prompt mode will append, mirroring the extension's prompt ghost. The text
/// is compiled into the client; no Prompt Library content crosses the bridge.
public enum PromptModePreview {
    /// Auto's fallback hint when the question contains no trigger word. The
    /// trigger names follow the extension's menu order.
    public static let autoTriggerLegend =
        "/brief 精简 · /study 学习 · /challenge 挑战 · /brainstorm 头脑风暴 · /think 深度思考"

    /// The preview for one mode and the current question. `nil` hides the
    /// preview (Default); Auto shows the matched modes' instructions, or the
    /// trigger legend when nothing matches.
    public static func text(for choice: PromptModeChoice, input: String = "") -> String? {
        switch choice {
        case .defaultMode:
            return nil
        case .auto:
            let matched = matchedModes(in: input)
            guard !matched.isEmpty else { return autoTriggerLegend }
            return matched.compactMap { instructions[$0] }.joined(separator: " ")
        default:
            return instructions[choice]
        }
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

    private static let modesInMenuOrder: [PromptModeChoice] = [
        .concise, .learning, .compete, .brainstorm, .deep
    ]

    private static let triggers: [PromptModeChoice: [String]] = [
        .concise: ["/brief", "/concise"],
        .learning: ["/study", "/learn"],
        .compete: ["/challenge", "/compete"],
        .brainstorm: ["/brainstorm", "/idea"],
        .deep: ["/think", "/deep"]
    ]

    /// The shipped Chinese instructions from _locales/zh_CN/messages.json
    /// (`promptModeSuffix_*`). Built-in mode prompts are editable in the
    /// extension, but the client cannot read the library; edits still apply
    /// to the send and are intentionally not mirrored here.
    private static let instructions: [PromptModeChoice: String] = [
        .concise: oneLine("请尽量简洁：直接给出结论和关键要点，省略铺垫、客套和重复。"),
        .learning: oneLine("请以教学方式回答：先给出核心结论，再循序渐进解释原理，配合例子，并在最后提出 1–2 个检验理解的问题。"),
        .compete: oneLine("""
        请充当上面这条消息的对抗性但公正的同行审稿人，而不是一味讨好我的助手。如果我的消息是请求而非主张，就把其中的做法及其假设当作待审主张。

        先用一两句话给出你的判断或最佳答案。然后复述我的核心主张或请求，并区分不可或缺的关键假设与次要假设；按危害从大到小，逐条攻击最薄弱、最含糊、最自相矛盾或最缺乏依据的地方，每条都按「问题 → 具体后果或失败场景 → 缺失的证据」来写。不要开场恭维，不要用「很好的问题」「视情况而定」「你可以考虑」之类的话淡化结论。只批评观点，不针对个人，每条批评都必须落到具体主张上。再补一句：什么证据会推翻你的判断。

        最后向我提出 3–5 个尖锐的澄清问题，不要问我已经回答过的内容；每个都要说明我的回答为何会改变结论，并在有用时给出两三个候选答案，方便我快速回复。如果这条消息无法按所问的方式回答，直接说明，不要猜测。
        """),
        .brainstorm: oneLine("请进行头脑风暴：给出多个不同角度、尽量多样甚至大胆的思路，简要说明各自优缺点，不急于下结论。"),
        .deep: oneLine("请逐步思考拆解问题，识别假设，分析根因，比较方案，反向验证，并在给出最终结论前，详细列出你的推导步骤，说明不确定性。")
    ]

    private static func oneLine(_ value: String) -> String {
        value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

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