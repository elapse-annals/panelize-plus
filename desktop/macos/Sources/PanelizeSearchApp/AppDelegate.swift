import AppKit
import PanelizeSearchCore

final class AppDelegate: NSObject, NSApplicationDelegate {
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
        let bridge = BridgeServer()
        self.bridge = bridge
        panelController = SearchPanelController(bridge: bridge)

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
        let statusItem = NSMenuItem(title: "浏览器：未连接", action: nil, keyEquivalent: "")
        statusItem.isEnabled = false
        menu.addItem(statusItem)
        self.statusMenuItem = statusItem

        menu.addItem(.separator())
        let quitItem = NSMenuItem(
            title: "退出 Panelize Search",
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