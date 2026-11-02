# Panelize macOS Global Prompt Sender

An optional macOS menu-bar client: press a shortcut from any app, type a prompt, and send it to every AI in the current Panelize window through the existing **Send All** flow, without switching to the browser first.

It reuses the extension's send flow and readiness gate: ready AIs receive the prompt, AIs still loading are skipped, and the floating panel reports how many received it. It does not search local prompts or answer logs, and it does not store prompts or answers.

## Requirements

- macOS 13 or later
- Chrome or Edge running with Panelize 2.59.0 or later (the prompt-mode picker needs Panelize 2.62.0 or later and the matching rebuilt native host)
- Xcode Command Line Tools (to build from source)

## Install

From the repository root:

```bash
./desktop/macos/Scripts/install.sh --browser chrome
```

The Chrome Web Store build uses the default extension ID. For an unpacked development build, pass the ID shown at `chrome://extensions`:

```bash
./desktop/macos/Scripts/install.sh --browser chrome --extension-id YOUR_EXTENSION_ID
```

Use `--browser edge` for Edge. The script:

1. builds `Panelize Search.app` and installs it under `~/Applications`;
2. writes the per-user Native Messaging host manifest, restricted to the given extension ID;
3. prints the remaining steps. It does not use `sudo` and does not add a login item.

After installing, reload the Panelize extension (or restart the browser), then open the app once:

```bash
open "$HOME/Applications/Panelize Search.app"
```

In Panelize's settings, open **Global Input (macOS)** and turn on **Enable global input bridge**. The bridge is off by default, so the extension neither launches the app nor keeps a native heartbeat until it is enabled. Once enabled, the browser starts the app in the background when needed after it reconnects. Optionally add the app to System Settings > General > Login Items. If you quit the app from the menu bar, the browser will not relaunch it; open it manually next time.

## Usage

- `Option + Space` (default) or the menu-bar item “打开快捷输入” opens the floating composer.
- Type a prompt and press `Enter` to send it to all AIs.
- Choose a prompt mode from the picker next to the send button; it defaults to Auto. The choice is saved on this Mac and applies only to that send, without changing the mode saved in the extension. Auto appends a mode only when the question contains a trigger word such as `/study`; Default appends nothing.
- `Shift + Enter` inserts a newline; `Esc` closes the panel.
- Choose `Command + Shift + Space` from the menu-bar icon instead.
- On success the panel shows “已发送至 N 个 AI” and closes after about a second. On failure it keeps the prompt and shows the reason.

If the Panelize page is not open, the extension opens it first and waits for the AI panels before sending. If the browser is not running, the extension was not reloaded, or the native host is not installed, the panel says “浏览器未连接” instead of reporting a false success.

## Security and limitations

- The desktop app and extension communicate only over a local Unix socket; the directory is `0700`, the socket and one-time token are `0600`.
- The Native Messaging host accepts only the extension origin configured at install time. It offers no shell, arbitrary URL, or file access.
- The browser must stay running; sending is unavailable after it quits.
- Local builds are ad-hoc signed, not Developer ID signed or notarized. Building from source avoids network distribution; public distribution needs separate signing and notarization.
- While visible, the app temporarily becomes a regular macOS app to take keyboard focus, then returns to menu-bar-only mode when hidden.

## Troubleshooting

**It always says “浏览器未连接”**

1. Confirm Panelize is at least 2.60.0, reload it on the extensions page, and enable **Global Input (macOS)** in Settings.
2. Confirm the extension ID used at install time matches `chrome://extensions`. An unpacked build can get a new ID when its path changes.
3. Check that `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.panelize.global_sender.json` exists and its `path` points to `~/Applications/Panelize Search.app/Contents/MacOS/PanelizeSearchBridge`.
4. Quit Chrome completely, reopen it, and open the app once more.

**The shortcut does nothing or reports a conflict**

Pick the other shortcut from the menu-bar icon. `Option + Space` may be taken by an input method or another utility.

**The build fails**

Confirm `xcode-select -p` points to valid Command Line Tools, then run:

```bash
swift test --package-path desktop/macos
./desktop/macos/Scripts/build-app.sh
```

## Uninstall

1. Quit the app from the menu bar.
2. Delete `~/Applications/Panelize Search.app`.
3. Delete the Native Messaging manifest:
   `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.panelize.global_sender.json`
   (for Edge, use `Microsoft Edge/NativeMessagingHosts`.)
4. Optionally delete `~/Library/Application Support/Panelize Search/`, which only contains the local bridge socket and token.

## Development

```bash
swift test --package-path desktop/macos
./desktop/macos/Scripts/build-app.sh
```

The build lands in `dist/Panelize Search.app` and is not included in extension release packages. Extension-side protocol tests live in `tests/global-send.test.js` and `tests/native-send.test.js`.