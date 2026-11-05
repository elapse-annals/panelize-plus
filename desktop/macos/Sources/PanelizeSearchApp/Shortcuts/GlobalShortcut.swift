import Carbon.HIToolbox
import Foundation
import PanelizeSearchCore

private let hotKeySignature: OSType = 0x504E4C5A // PNLZ

private func hotKeyEventHandler(
    _ nextHandler: EventHandlerCallRef?,
    _ event: EventRef?,
    _ userData: UnsafeMutableRawPointer?
) -> OSStatus {
    guard let userData else {
        return OSStatus(eventNotHandledErr)
    }
    let manager = Unmanaged<GlobalShortcutManager>.fromOpaque(userData).takeUnretainedValue()
    DispatchQueue.main.async {
        manager.onPressed?()
    }
    return noErr
}

final class GlobalShortcutManager {
    private var hotKeyRef: EventHotKeyRef?
    private var handlerRef: EventHandlerRef?
    var onPressed: (() -> Void)?

    deinit {
        unregister()
    }

    @discardableResult
    func register(_ choice: ShortcutChoice) -> OSStatus {
        unregister()

        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let installStatus = InstallEventHandler(
            GetApplicationEventTarget(),
            hotKeyEventHandler,
            1,
            &eventType,
            Unmanaged.passUnretained(self).toOpaque(),
            &handlerRef
        )
        guard installStatus == noErr else {
            return installStatus
        }

        let modifiers: UInt32
        switch choice {
        case .controlSpace:
            modifiers = UInt32(controlKey)
        case .optionSpace:
            modifiers = UInt32(optionKey)
        case .commandShiftSpace:
            modifiers = UInt32(cmdKey | shiftKey)
        }

        let hotKeyID = EventHotKeyID(signature: hotKeySignature, id: 1)
        let registerStatus = RegisterEventHotKey(
            UInt32(kVK_Space),
            modifiers,
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
        if registerStatus != noErr {
            unregister()
        }
        return registerStatus
    }

    func unregister() {
        if let hotKeyRef {
            UnregisterEventHotKey(hotKeyRef)
            self.hotKeyRef = nil
        }
        if let handlerRef {
            RemoveEventHandler(handlerRef)
            self.handlerRef = nil
        }
    }

    static func describe(_ status: OSStatus) -> String {
        if status == eventHotKeyExistsErr {
            return "该快捷键已被其他应用占用，请在菜单栏选择另一个快捷键。"
        }
        return "无法注册全局快捷键（错误 \(status)），请在菜单栏选择另一个快捷键。"
    }
}