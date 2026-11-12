# Panelize Link (macOS Global Prompt Sender)

An optional macOS menu-bar client: press a shortcut from any app, type a prompt, and send it to every AI in the current Panelize window through the existing **Send All** flow, without switching to the browser first.

It reuses the extension's send flow and readiness gate: ready AIs receive the prompt, AIs still loading are skipped, and the floating panel reports how many received it. It keeps the last three days of sent questions and their AI summaries on this Mac, mirrored from the extension over the local native bridge, and offers them in a two-column history browser; the prefix suggestion list still shows the three most recent matches. It does not search local prompts or answer logs, and it does not store provider answers.

## Requirements

- macOS 13 or later on Apple silicon (arm64)
- Chrome or Edge running with Panelize 2.59.0 or later (the prompt-mode picker needs Panelize 2.62.0 or later; three-day history sync and the new-chat checkbox need Panelize 2.93.0 or later, with a rebuilt native host)
- Xcode Command Line Tools (only to build from source)

## Install

Download `panelize-link-<version>-macos-arm64.zip` from [Releases](https://github.com/elapse-annals/panelize-plus/releases) and unzip it. The archive includes the app, an interactive installer and these instructions; you do not need a repository checkout, Node.js or Swift to install the release.

In the extracted folder, double-click `Install.command`, choose Chrome or Edge, then paste the extension ID shown on that browser's extensions page. The installer also accepts a full `chrome-extension://...` settings URL. It installs the neighboring app under `~/Applications` and registers the Native Messaging host for the chosen browser. If macOS blocks the command file, open Terminal in the extracted folder and run:

```bash
bash ./install.sh --browser chrome --extension-id YOUR_EXTENSION_ID
```

Replace the extension ID with the value from `chrome://extensions` or `edge://extensions`. The `--browser` option accepts `chrome` or `edge`. The installer keeps timestamped backups of an existing app and native-host manifest before replacing them. Registration is per user and does not use `sudo`.

The release app is ad-hoc signed, not notarized: on first launch, right-click the app and choose **Open**, or allow it under System Settings → Privacy & Security.

To build from source instead, run the installer without `--app` from the repository root:

```bash
./desktop/macos/Scripts/install.sh --browser chrome
```

For development installs from a repository checkout, the installer uses the ID Chrome assigns to that checkout when it is loaded unpacked from the repository root. If the extension is loaded from another path, or from the Chrome Web Store, pass the ID shown at `chrome://extensions`. When `--app` points to a downloaded app, pass `--extension-id` explicitly:

```bash
./desktop/macos/Scripts/install.sh --browser chrome --extension-id YOUR_EXTENSION_ID
```

The script:

1. builds the app from source, or installs the adjacent downloaded app under `~/Applications`;
2. writes the per-user Native Messaging host manifest, restricted to the given extension ID;
3. prints the remaining steps. It does not use `sudo` and does not add a login item.

After installing, reload the Panelize extension (or restart the browser), then open the app once:

```bash
open "$HOME/Applications/Panelize Link.app"
```

Dragging only `Panelize Link.app` into Applications does not register the browser bridge. Run the installer in the release archive so it can create the native-host manifest with the actual extension ID and installed app path.

In Panelize's settings, open **Global Input (macOS)** and turn on **Enable global input bridge**. The bridge is off by default, so the extension neither launches the app nor keeps a native heartbeat until it is enabled. Once enabled, the browser starts the app in the background when needed after it reconnects. Optionally add the app to System Settings > General > Login Items. If you quit the app from the menu bar, the browser will not relaunch it; open it manually next time.

## Usage

- `Option + Space` (default) or the menu-bar item “打开快捷输入” opens the floating composer.
- The composer opens near the bottom of the current display with a soft shadow. Click anywhere outside it, or click the menu-bar icon, to close it; `Esc` also works.
- Type a prompt and press `Enter` to send it to all AIs. As soon as the extension confirms the Panelize page is open or reused, the browser running the bridge comes to the front, and the floating panel stays up to show progress: “AI 准备中：3/5” while the AIs get ready, then “正在发送…”. While sending, the line under the input names the AIs still being waited for (or those that are not ready); long lists are shortened and keep the full list on hover and for assistive technologies. Blind mode shows counts only. Sending starts once `ceil(total × 0.7)` of the AIs are ready.
- The panel is not dismissed when the app loses focus during the send or while the success result is shown. An outside click, `Esc` or the shortcut still closes it, and progress updates never reopen it; opening it again shows the latest progress. Once the send result arrives, progress ends and the mode preview returns.
- The three most recently matched questions appear above the input when what you type is the beginning of one. The list floats in its own panel, titled “Recent questions” and narrower than the input card, sitting flush above it and tucked behind it, so it is not mistaken for the input itself. Use `Up` / `Down` to highlight, `Enter` to fill it in without sending, or click a row; pressing `Down` on the last row clears the highlight and returns to the input.
- With the input completely empty, press `Up` to open the three-day history browser above the composer. The left column lists every question from the last 72 hours, newest first, with its relative time and whether a summary exists; the right column shows the selected question's AI summary. Use `Up` / `Down` to switch rows, `Enter`, double-click or “填入提问” to fill the question without sending, and drag to select or “复制总结” to copy the summary text. Blind-mode summaries keep their anonymous “匿名模型 N” labels. `Esc` closes only the browser first, then the next `Esc` closes the panel; typing dismisses the browser and goes into the input. The browser shrinks to fit the screen above the composer.
- The “新建会话” checkbox in the footer is remembered across launches. Checking it silently asks the extension to start fresh conversations for every AI without bringing Chrome forward or taking focus from the composer. A send that follows an un-sent reset reuses that fresh conversation; after a round is sent, the next round prepares another reset automatically. Unchecking it keeps the next send in the current conversation. If the reset is still running when you press send, the extension waits for it instead of dropping the message; partial failures show a short orange hint and the send still works.
- Choose a prompt mode from the capsule picker at the left of the footer; it defaults to Auto. Each mode's explanation appears under its menu item and, for the selected mode, on a persistent line below the picker. Prompt names, explanations, trigger legend and preview text follow the macOS system language: Chinese variants use Chinese, every other language uses English. The choice is saved on this Mac and applies only to that send, without changing the mode saved in the extension. Auto appends a mode only when the question contains a trigger word such as `/study`; Default appends nothing. Upgrading to 2.64.0 resets a previously saved mode to Auto once; choices made afterwards are kept. Press `Tab` / `Shift + Tab` while the input is empty to cycle modes; when a trigger completion is showing, `Tab` accepts the completion instead. With text present, `Tab` does not change the mode.
- In Auto mode, typing a trigger prefix at the end of a line (`/st`) shows the rest of the trigger (`udy`) and a shaded `Tab · 学习` hint at the caret. Press `Tab` to accept it and add a space. Completion follows the extension's line-end and whole-word rules and only covers the built-in triggers; triggers customized in the extension are not mirrored in the client.
- The line under the input previews what the selected mode will append: a built-in mode shows its shipped instruction in faint text, Auto shows the matched mode or its trigger legend, and Default shows nothing. The footer keeps light inline hints for `Enter`, `Shift + Enter`, `Tab` (switch mode) and `Esc`. When connected, it shows only a green check icon; short text appears when the bridge is disconnected, a send is in progress, or an error occurs. While disconnected, clicking that status (or the menu-bar browser status) opens Panelize's settings page at **Enable global input bridge** and highlights the switch; the browser and extension ID come from the installed native-host manifest.
- The input grows from about three to five lines as you type and scrolls beyond that; sending or clearing the prompt collapses it again. The send button shows a small spinner while the prompt is being sent.
- `Command + A / C / V / X / Z` select all, copy, paste, cut and undo; `Shift + Command + Z` redoes. The same commands are available from the Edit menu.
- The composer follows macOS Reduce Motion, Reduce Transparency and Increase Contrast. With Reduce Transparency it uses an opaque background; with Increase Contrast it strengthens borders and text, and status always uses a distinct icon shape as well as color.
- `Shift + Enter` inserts a newline; `Esc` closes an open history browser first, then an open suggestion list, otherwise the panel.
- Choose `Command + Shift + Space` from the menu-bar icon instead.
- On success the panel shows “已发送至 N 个 AI” and closes after about a second; the browser was already brought forward when the extension opened or reused the Panelize page (with an older extension that sends no progress, the browser comes forward on the result instead). On failure it keeps the prompt and shows the reason.

If the Panelize page is not open, the extension opens it first and waits for the AI panels before sending. If the browser is not running, the extension was not reloaded, or the native host is not installed, the panel says “浏览器未连接” instead of reporting a false success.

## Security and limitations

- The desktop app and extension communicate only over a local Unix socket; the directory is `0700`, the socket and one-time token are `0600`.
- The Native Messaging host accepts only the extension origin configured at install time. It offers no shell, arbitrary URL, or file access.
- The app listens only to mouse-down events delivered to other apps so it can dismiss the composer on an outside click. It does not record clicks or keyboard input, and mouse monitoring does not require Accessibility permission.
- The last three days of questions and their AI summary text stay on this Mac in `UserDefaults` (`questionHistory.v1`, migrated once from the older three-item `recentQuestions.v1`). When the extension bridge is enabled they are exchanged with the browser over the local native bridge; records older than 72 hours are pruned on read and sync, and blind-mode summaries stay anonymous. Clearing the app's preferences removes them.
- Built-in prompt mode titles, explanations, previews and trigger definitions are generated at build time from the extension's `_locales/zh_CN/messages.json`, `_locales/en/messages.json` and `modules/prompts/prompt-modes.js` via `scripts/sync-desktop-prompts.js`, ensuring a single source of truth; the client picks Chinese or English from the macOS system language at launch. At runtime, the native app never receives Prompt Library content. Editing a built-in mode in the extension changes what is sent but is not reflected in the native preview.
- The browser must stay running; sending is unavailable after it quits.
- Local builds are ad-hoc signed, not Developer ID signed or notarized. Building from source avoids network distribution; public distribution needs separate signing and notarization.
- While visible, the app temporarily becomes a regular macOS app to take keyboard focus, then returns to menu-bar-only mode when hidden.

## Troubleshooting

**It always says “浏览器未连接”**

1. Confirm Panelize is at least 2.60.0, reload it on the extensions page, and enable **Global Input (macOS)** in Settings.
2. Rerun `Install.command` or `bash ./install.sh` from the extracted release folder, selecting the browser in use and entering the current extension ID. An unpacked build can get a new ID when its path changes.
3. Check that the selected browser's `NativeMessagingHosts/com.panelize.global_sender.json` exists and its `path` points to `~/Applications/Panelize Link.app/Contents/MacOS/PanelizeSearchBridge`.
4. Quit the browser completely, reopen it, and open the app once more.

**History or “新建会话” does not work after upgrading**

The browser keeps the old native-host process until it restarts. Quit Chrome/Edge completely and reopen it, reload Panelize 2.93.0 or later on the extensions page, then reopen Panelize Link. An older extension still sends prompts, but it advertises no history/new-chat capability, so the app hides those results.

**Clicking the status opens “This page has been blocked by Chrome” (`ERR_BLOCKED_BY_CLIENT`)**

The native-host manifest names an extension ID that Chrome has not loaded, or that is disabled. Rerun the installer with the ID shown at `chrome://extensions` or `edge://extensions`.

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

The build lands in `dist/Panelize Link.app` and is not included in extension release packages. On an Apple silicon Mac, package it and attach it to the release published by Release Publish:

```bash
RELEASE_VERSION=x.y.z ./scripts/release/package-macos-app.sh
gh release upload "vx.y.z" "dist/release-x.y.z/panelize-link-x.y.z-macos-arm64.zip"
```

Extension-side protocol tests live in `tests/unit/platform/global-send.test.js` and `tests/unit/background/native-send.test.js`.
