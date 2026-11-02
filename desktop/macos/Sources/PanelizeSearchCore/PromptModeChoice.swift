import Foundation

/// The prompt mode applied to one prompt sent from the macOS client. Raw
/// values are the wire contract shared with the extension; `defaultMode` is
/// an explicit "append nothing" choice, while a missing value lets the
/// extension keep its own selected mode.
public enum PromptModeChoice: String, CaseIterable {
    case defaultMode = "default"
    case auto
    case concise
    case learning
    case compete
    case brainstorm
    case deep

    public static let defaultsKey = "promptMode"
    public static let fallback: PromptModeChoice = .auto

    public var title: String {
        switch self {
        case .defaultMode:
            return "默认"
        case .auto:
            return "自动"
        case .concise:
            return "精简"
        case .learning:
            return "学习"
        case .compete:
            return "挑战"
        case .brainstorm:
            return "头脑风暴"
        case .deep:
            return "深度思考"
        }
    }

    public var detail: String {
        switch self {
        case .defaultMode:
            return "不追加任何内容"
        case .auto:
            return "仅当问题包含 /study、/brief 等触发词时追加对应模式"
        case .concise:
            return "只给结论和要点"
        case .learning:
            return "先给结论，再解释原理"
        case .compete:
            return "对抗审查：判断、薄弱假设与澄清问题"
        case .brainstorm:
            return "多角度发散，不急于下结论"
        case .deep:
            return "拆解问题、验证假设并展示推导步骤"
        }
    }

    public static func load(from defaults: UserDefaults = .standard) -> PromptModeChoice {
        guard let raw = defaults.string(forKey: defaultsKey),
              let choice = PromptModeChoice(rawValue: raw) else {
            return fallback
        }
        return choice
    }

    public func save(to defaults: UserDefaults = .standard) {
        defaults.set(rawValue, forKey: Self.defaultsKey)
    }

    /// Only a whitelisted wire value is accepted; missing or invalid values
    /// leave the extension's own mode in effect.
    public static func wireValue(from message: [String: Any]) -> PromptModeChoice? {
        guard let raw = message["promptMode"] as? String else {
            return nil
        }
        return PromptModeChoice(rawValue: raw)
    }
}
