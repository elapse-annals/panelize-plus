import AppKit
import PanelizeSearchCore

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem?
    private var bridge: BridgeServer?
    private var panelController: SearchPanelController?
    private let shortcutManager = GlobalShortcutManager()
    private var shortcutChoice = ShortcutChoice.load()
    private var connectionStatus = "浏览器未连接"
    private var connectionReady = false
    private var shortcutMenu: NSMenu?
    private var statusMenuItem: NSMenuItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        PromptModeChoice.applyAutoDefaultMigrationIfNeeded()
        let bridge = BridgeServer()
        self.bridge = bridge
        panelController = SearchPanelController(bridge: bridge)
        panelController?.onOpenBridgeSettings = {
            BridgeSettingsLauncher.openBridgeSettings()
        }

        bridge.onStatusChange = { [weak self] status in
            guard let self else { return }
            self.connectionStatus = status
            self.connectionReady = status.contains("已连接") && !status.contains("等待扩展")
            self.panelController?.setConnectionStatus(status, ready: self.connectionReady)
            self.refreshMenu()
        }

        do {
            try bridge.start()
        } catch {
            connectionStatus = "本地桥启动失败"
            panelController?.setConnectionStatus(connectionStatus, ready: false)
        }

        shortcutManager.onPressed = { [weak self] in
            self?.panelController?.toggle()
        }
        registerShortcut(shortcutChoice, announceFailure: false)
        setupMainMenu()
        setupStatusItem()
        if CommandLine.arguments.contains("--show") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                self?.panelController?.show()
            }
        }

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appearanceChanged),
            name: NSApplication.didChangeScreenParametersNotification,
            object: nil
        )
    }

    func applicationWillTerminate(_ notification: Notification) {
        shortcutManager.unregister()
        bridge?.stop()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    @objc private func appearanceChanged() {
        panelController?.window?.invalidateShadow()
        panelController?.repositionForScreenChanges()
    }

    /// A minimal standard menu so Command-A/C/V/X/Z reach the composer text
    /// view. The app is menu-bar-only until the composer appears; while the
    /// panel is visible the regular app shows this menu.
    private func setupMainMenu() {
        let appName = "Panelize Link"
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem(title: appName, action: nil, keyEquivalent: "")
        let appMenu = NSMenu(title: appName)
        appMenu.addItem(
            withTitle: "关于 \(appName)",
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(.separator())
        let hideItem = appMenu.addItem(
            withTitle: "隐藏 \(appName)",
            action: #selector(NSApplication.hide(_:)),
            keyEquivalent: "h"
        )
        hideItem.target = NSApp
        let hideOthersItem = appMenu.addItem(
            withTitle: "隐藏其他",
            action: #selector(NSApplication.hideOtherApplications(_:)),
            keyEquivalent: "h"
        )
        hideOthersItem.keyEquivalentModifierMask = [.command, .option]
        hideOthersItem.target = NSApp
        let showAllItem = appMenu.addItem(
            withTitle: "显示全部",
            action: #selector(NSApplication.unhideAllApplications(_:)),
            keyEquivalent: ""
        )
        showAllItem.target = NSApp
        appMenu.addItem(.separator())
        let quitItem = appMenu.addItem(
            withTitle: "退出 \(appName)",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        quitItem.target = NSApp
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        let editMenuItem = NSMenuItem(title: "编辑", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "编辑")
        let undoItem = editMenu.addItem(
            withTitle: "撤销",
            action: Selector(("undo:")),
            keyEquivalent: "z"
        )
        undoItem.target = nil
        let redoItem = editMenu.addItem(
            withTitle: "重做",
            action: Selector(("redo:")),
            keyEquivalent: "Z"
        )
        redoItem.target = nil
        editMenu.addItem(.separator())
        let cutItem = editMenu.addItem(
            withTitle: "剪切",
            action: #selector(NSText.cut(_:)),
            keyEquivalent: "x"
        )
        cutItem.target = nil
        let copyItem = editMenu.addItem(
            withTitle: "复制",
            action: #selector(NSText.copy(_:)),
            keyEquivalent: "c"
        )
        copyItem.target = nil
        let pasteItem = editMenu.addItem(
            withTitle: "粘贴",
            action: #selector(NSText.paste(_:)),
            keyEquivalent: "v"
        )
        pasteItem.target = nil
        let selectAllItem = editMenu.addItem(
            withTitle: "全选",
            action: #selector(NSText.selectAll(_:)),
            keyEquivalent: "a"
        )
        selectAllItem.target = nil
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        NSApp.mainMenu = mainMenu
    }

    private func setupStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = item.button {
            button.image = NSImage(
                systemSymbolName: "text.bubble.fill",
                accessibilityDescription: "Panelize 全局发送"
            )
            button.toolTip = "Panelize 全局发送（\(shortcutChoice.title)）"
        }

        let menu = NSMenu()
        menu.delegate = self
        // The status item is enabled only while the browser is disconnected.
        menu.autoenablesItems = false
        let openItem = NSMenuItem(
            title: "打开快捷输入",
            action: #selector(openPanel),
            keyEquivalent: ""
        )
        openItem.target = self
        menu.addItem(openItem)

        let shortcutItem = NSMenuItem(title: "全局快捷键", action: nil, keyEquivalent: "")
        let shortcutMenu = NSMenu()
        for choice in ShortcutChoice.allCases {
            let item = NSMenuItem(
                title: choice.detail,
                action: #selector(changeShortcut(_:)),
                keyEquivalent: ""
            )
            item.target = self
            item.representedObject = choice.rawValue
            shortcutMenu.addItem(item)
        }
        shortcutItem.submenu = shortcutMenu
        menu.addItem(shortcutItem)
        self.shortcutMenu = shortcutMenu

        menu.addItem(.separator())
        let statusItem = NSMenuItem(
            title: "浏览器：未连接",
            action: #selector(openBridgeSettings),
            keyEquivalent: ""
        )
        statusItem.target = self
        statusItem.isEnabled = false
        menu.addItem(statusItem)
        self.statusMenuItem = statusItem

        menu.addItem(.separator())
        let quitItem = NSMenuItem(
            title: "退出 Panelize Link",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        menu.addItem(quitItem)

        item.menu = menu
        self.statusItem = item
        refreshMenu()
    }

    private func refreshMenu() {
        statusMenuItem?.title = "浏览器：\(connectionStatus)"
        statusMenuItem?.isEnabled = !connectionReady
        for item in shortcutMenu?.items ?? [] {
            guard let raw = item.representedObject as? String,
                  let choice = ShortcutChoice(rawValue: raw) else {
                continue
            }
            item.state = choice == shortcutChoice ? .on : .off
        }
        statusItem?.button?.toolTip = "Panelize 全局发送（\(shortcutChoice.title)）"
    }

    @objc private func openPanel() {
        panelController?.show()
    }

    @objc private func openBridgeSettings() {
        guard !BridgeSettingsLauncher.openBridgeSettings() else { return }
        let alert = NSAlert()
        alert.messageText = "未找到扩展设置"
        alert.informativeText = "请先在浏览器打开 Panelize 扩展设置，并在「全局快捷输入（macOS）」中开启「启用全局输入桥接」。"
        alert.runModal()
    }

    func menuWillOpen(_ menu: NSMenu) {
        panelController?.hide()
    }

    @objc private func changeShortcut(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String,
              let choice = ShortcutChoice(rawValue: raw),
              choice != shortcutChoice else {
            return
        }
        let previous = shortcutChoice
        registerShortcut(choice, announceFailure: true)
        if shortcutChoice == choice {
            choice.save()
        } else {
            // Restore the previous hotkey instead of leaving the app with none.
            shortcutChoice = previous
            _ = shortcutManager.register(previous)
        }
        refreshMenu()
    }

    private func registerShortcut(_ choice: ShortcutChoice, announceFailure: Bool) {
        let status = shortcutManager.register(choice)
        if status == noErr {
            shortcutChoice = choice
        } else if announceFailure {
            let alert = NSAlert()
            alert.messageText = "全局快捷键不可用"
            alert.informativeText = GlobalShortcutManager.describe(status)
            alert.alertStyle = .warning
            alert.addButton(withTitle: "好")
            alert.runModal()
        }
    }
}