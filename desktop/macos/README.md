# Panelize Link (macOS Global Prompt Sender)

An optional macOS menu-bar client: press a shortcut from any app, type a prompt, and send it to every AI in the current Panelize window through the existing **Send All** flow, without switching to the browser first.

It reuses the extension's send flow and readiness gate: ready AIs receive the prompt, AIs still loading are skipped, and the floating panel reports how many received it. It keeps the last three sent questions on this Mac to suggest them as you type; it does not search local prompts or answer logs, and it never stores answers.

## Requirements

- macOS 13 or later on Apple silicon (arm64)
- Chrome or Edge running with Panelize 2.59.0 or later (the prompt-mode picker needs Panelize 2.62.0 or later and the matching rebuilt native host)
- Xcode Command Line Tools (to build from source)

## Install

Download `panelize-link-<version>-macos-arm64.zip` from [Releases](https://github.com/elapse-annals/panelize-plus/releases) and unzip it, then register the app with the installer from a repository checkout:

```bash
./desktop/macos/Scripts/install.sh --browser chrome --app "$HOME/Downloads/Panelize Link.app"
```

The release build is ad-hoc signed, not notarized: on first launch, right-click the app and choose **Open**, or allow it under System Settings → Privacy & Security.

To build from source instead, run the installer without `--app` from the repository root:

```bash
./desktop/macos/Scripts/install.sh --browser chrome
```

By default the installer uses the ID Chrome assigns to this checkout when it is loaded unpacked from the repository root, so the native-host manifest matches the extension it ships with. If the extension is loaded from another path, or from the Chrome Web Store, pass the ID shown at `chrome://extensions`:

```bash
./desktop/macos/Scripts/install.sh --browser chrome --extension-id YOUR_EXTENSION_ID
```

Use `--browser edge` for Edge. The script:

1. builds `Panelize Link.app` and installs it under `~/Applications`;
2. writes the per-user Native Messaging host manifest, restricted to the given extension ID;
3. prints the remaining steps. It does not use `sudo` and does not add a login item.

After installing, reload the Panelize extension (or restart the browser), then open the app once:

```bash
open "$HOME/Applications/Panelize Link.app"
```

In Panelize's settings, open **Global Input (macOS)** and turn on **Enable global input bridge**. The bridge is off by default, so the extension neither launches the app nor keeps a native heartbeat until it is enabled. Once enabled, the browser starts the app in the background when needed after it reconnects. Optionally add the app to System Settings > General > Login Items. If you quit the app from the menu bar, the browser will not relaunch it; open it manually next time.

## Usage

- `Option + Space` (default) or the menu-bar item “打开快捷输入” opens the floating composer.
- The composer opens near the bottom of the current display with a soft shadow. Click anywhere outside it, or click the menu-bar icon, to close it; `Esc` also works.
- Type a prompt and press `Enter` to send it to all AIs. As soon as the extension confirms the Panelize page is open or reused, the browser running the bridge comes to the front, and the floating panel stays up to show progress: “AI 准备中：3/5” while the AIs get ready, then “正在发送…”. While sending, the line under the input names the AIs still being waited for (or those that are not ready); long lists are shortened and keep the full list on hover and for assistive technologies. Blind mode shows counts only. Sending starts once `ceil(total × 0.7)` of the AIs are ready.
- The panel is not dismissed when the app loses focus during the send or while the success result is shown. An outside click, `Esc` or the shortcut still closes it, and progress updates never reopen it; opening it again shows the latest progress. Once the send result arrives, progress ends and the mode preview returns.
- The three most recently sent questions appear above the input when what you type is the beginning of one. The list floats in its own panel, titled “Recent questions” and narrower than the input card, sitting flush above it and tucked behind it, so it is not mistaken for the input itself. Use `Up` / `Down` to highlight, `Enter` to fill it in without sending, or click a row; pressing `Down` on the last row clears the highlight and returns to the input. `Esc` closes the list first, then the panel.
- Choose a prompt mode from the capsule picker at the left of the footer; it defaults to Auto. The choice is saved on this Mac and applies only to that send, without changing the mode saved in the extension. Auto appends a mode only when the question contains a trigger word such as `/study`; Default appends nothing. Upgrading to 2.64.0 resets a previously saved mode to Auto once; choices made afterwards are kept. Press `Tab` / `Shift + Tab` while the input is empty to cycle modes; when a trigger completion is showing, `Tab` accepts the completion instead. With text present, `Tab` does not change the mode.
- In Auto mode, typing a trigger prefix at the end of a line (`/st`) shows the rest of the trigger (`udy`) and a shaded `Tab · 学习` hint at the caret. Press `Tab` to accept it and add a space. Completion follows the extension's line-end and whole-word rules and only covers the built-in triggers; triggers customized in the extension are not mirrored in the client.
- The line under the input previews what the selected mode will append: a built-in mode shows its shipped instruction in faint text, Auto shows the matched mode or its trigger legend, and Default shows nothing. The footer keeps light inline hints for `Enter`, `Shift + Enter`, `Tab` (switch mode) and `Esc`. When connected, it shows only a green check icon; short text appears when the bridge is disconnected, a send is in progress, or an error occurs. While disconnected, clicking that status (or the menu-bar browser status) opens Panelize's settings page at **Enable global input bridge** and highlights the switch; the browser and extension ID come from the installed native-host manifest.
- The input grows from about three to five lines as you type and scrolls beyond that; sending or clearing the prompt collapses it again. The send button shows a small spinner while the prompt is being sent.
- `Command + A / C / V / X / Z` select all, copy, paste, cut and undo; `Shift + Command + Z` redoes. The same commands are available from the Edit menu.
- The composer follows macOS Reduce Motion, Reduce Transparency and Increase Contrast. With Reduce Transparency it uses an opaque background; with Increase Contrast it strengthens borders and text, and status always uses a distinct icon shape as well as color.
- `Shift + Enter` inserts a newline; `Esc` closes an open suggestion list first, otherwise the panel.
- Choose `Command + Shift + Space` from the menu-bar icon instead.
- On success the panel shows “已发送至 N 个 AI” and closes after about a second; the browser was already brought forward when the extension opened or reused the Panelize page (with an older extension that sends no progress, the browser comes forward on the result instead). On failure it keeps the prompt and shows the reason.

If the Panelize page is not open, the extension opens it first and waits for the AI panels before sending. If the browser is not running, the extension was not reloaded, or the native host is not installed, the panel says “浏览器未连接” instead of reporting a false success.

## Security and limitations

- The desktop app and extension communicate only over a local Unix socket; the directory is `0700`, the socket and one-time token are `0600`.
- The Native Messaging host accepts only the extension origin configured at install time. It offers no shell, arbitrary URL, or file access.
- The app listens only to mouse-down events delivered to other apps so it can dismiss the composer on an outside click. It does not record clicks or keyboard input, and mouse monitoring does not require Accessibility permission.
- The last three questions stay in this Mac's `UserDefaults` (`recentQuestions.v1`) and never cross the native bridge; clearing the app's preferences removes them.
- Built-in prompt mode previews and trigger definitions are generated at build time from the extension's `_locales/zh_CN/messages.json` and `modules/prompts/prompt-modes.js` via `scripts/sync-desktop-prompts.js`, ensuring a single source of truth; at runtime, the native app never receives Prompt Library content. Editing a built-in mode in the extension changes what is sent but is not reflected in the native preview.
- The browser must stay running; sending is unavailable after it quits.
- Local builds are ad-hoc signed, not Developer ID signed or notarized. Building from source avoids network distribution; public distribution needs separate signing and notarization.
- While visible, the app temporarily becomes a regular macOS app to take keyboard focus, then returns to menu-bar-only mode when hidden.

## Troubleshooting

**It always says “浏览器未连接”**

1. Confirm Panelize is at least 2.60.0, reload it on the extensions page, and enable **Global Input (macOS)** in Settings.
2. Confirm the extension ID used at install time matches `chrome://extensions`. An unpacked build can get a new ID when its path changes.
3. Check that `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.panelize.global_sender.json` exists and its `path` points to `~/Applications/Panelize Link.app/Contents/MacOS/PanelizeSearchBridge`.
4. Quit Chrome completely, reopen it, and open the app once more.

**Clicking the status opens “This page has been blocked by Chrome” (`ERR_BLOCKED_BY_CLIENT`)**

The native-host manifest names an extension ID that Chrome has not loaded, or that is disabled. Rerun the installer so it derives the ID from this checkout, or pass the ID shown at `chrome://extensions` with `--extension-id`.

**The shortcut does nothing or reports a conflict**

Pick another shortcut (`Control + Space` or `Command + Shift + Space`) from the menu-bar icon. `Option + Space` may be taken by an input method or another utility.

**The build fails**

Confirm `xcode-select -p` points to valid Command Line Tools, then run:

```bash
swift test --package-path desktop/macos
./desktop/macos/Scripts/build-app.sh
```

## Uninstall

1. Quit the app from the menu bar.
2. Delete `~/Applications/Panelize Link.app`.
3. Delete the Native Messaging manifest:
   `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.panelize.global_sender.json`
   (for Edge, use `Microsoft Edge/NativeMessagingHosts`.)
4. Optionally delete `~/Library/Application Support/Panelize Link/`, which only contains the local bridge socket and token.

## Development

```bash
swift test --package-path desktop/macos
./desktop/macos/Scripts/build-app.sh
```

The build lands in `dist/Panelize Link.app` and is not included in extension release packages; the release pipeline attaches it separately as `panelize-link-<version>-macos-arm64.zip`. Extension-side protocol tests live in `tests/unit/platform/global-send.test.js` and `tests/unit/background/native-send.test.js`.