import AppKit
import PanelizeSearchCore

let application = NSApplication.shared
let existing = NSRunningApplication
    .runningApplications(withBundleIdentifier: BridgeProtocol.appBundleIdentifier)
    .first { $0.processIdentifier != getpid() }
if let existing {
    existing.activate(options: [.activateAllWindows])
    exit(EXIT_SUCCESS)
}

application.setActivationPolicy(.accessory)
let delegate = AppDelegate()
application.delegate = delegate
application.run()