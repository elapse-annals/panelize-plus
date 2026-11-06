# Changelog

## 2.90.0 - 2026-11-06
- The macOS client now shows each prompt mode's explanation by default: a subtitle under the mode in the picker menu, plus a persistent line below the picker for the selected mode. Mode names, explanations, Auto's trigger legend and preview instructions are generated at build time from both extension locale files and follow the macOS system language (Chinese variants use Chinese, every other language uses English), replacing the hand-written Chinese-only strings. On macOS 13–14.3 the menu uses an indented disabled hint row because the native menu subtitle API starts at macOS 14.4.

## 2.89.0 - 2026-11-06
- Added the **1xN Auto** layout: one row whose column count always equals the open panel count. Adding or removing a panel grows or shrinks the row immediately, and choosing the layout itself never adds or removes panels. It is available in the layout picker and as a default layout in Settings, and persists as `multiPanelLayout: '1x-auto'`.

## 2.88.1 - 2026-11-06
- Fixed fresh installations treating an unsaved provider list as empty during permission reconciliation, which removed Qianwen's frame-header rule after the user granted site access and could show “www.qianwen.com refused to connect”. The reconciliation now uses the same default provider list as Settings and Multi-Panel, without changing explicitly saved choices.
- The macOS download now includes a standalone installer and English/Chinese setup instructions. Double-click `Install.command`, choose Chrome or Edge and enter the actual extension ID (or its settings URL) to install the app and register Native Messaging without a repository checkout or developer tools; dragging the app alone does not register the bridge.
- Downloaded-app installs require an explicit extension ID instead of deriving one from the download location. Existing apps and host manifests are backed up, host paths are JSON-escaped, and the installer explains how to enable or reconnect the extension bridge. Source-checkout installs keep their derived-ID default.

## 2.88.0 - 2026-11-05
- macOS packaging now runs locally: `scripts/release/package-macos-app.sh` builds Panelize Link for Apple silicon (arm64), and `gh release upload vX.Y.Z dist/release-X.Y.Z/panelize-link-X.Y.Z-macos-arm64.zip` attaches it to the published release. Release Publish keeps building and uploading only the extension zips, while its release notes still name the macOS asset.
- `install.sh --app` installs and registers an already-downloaded `Panelize Link.app`, so the release build works without a local Swift toolchain; the macOS docs cover the ad-hoc signed first launch and the download install path.

## 2.87.1 - 2026-11-05
- Release Publish no longer requires a merged `release/x.y.z` pull request: dispatching it from `master` validates the synchronized version files, the dated changelog section and that the target tag and release are still missing, then builds, tags and publishes. The release branch check remains for release PRs.

## 2.87.0 - 2026-11-05
- Prompts now send exactly the text the app shows. `content` is what the library, mode menu, placeholder and send preview display and what the AIs receive; `contentEn` is only a fallback for a prompt whose `content` is empty. Selecting a bilingual prompt into the composer no longer sends its hidden English variant when left unedited.
- The prompt editor's English field and the import/export guide describe the fallback role, and the docs no longer claim Chinese display with English sending.

## 2.86.0 - 2026-11-05
- Removed the Japanese README and its links, so the documentation matches the interface and is available in English and Simplified Chinese only.

## 2.85.1 - 2026-11-05
- New conversation no longer reports a provider as confirmed when it cannot recognise the page's old conversation. Providers without known message nodes now only skip the click on their canonical new-chat URL, so ChatGPT, DeepSeek, ChatGLM, Z.ai, MiMo, Yuanbao and the other affected sites are reset again; Gemini and Qwen keep their existing blank-page behaviour.
- Providers without a new-chat button selector (Perplexity, Wenxin, Copilot, StepFun, Agnes, Hy AI Studio) now fall back to their new-chat URL instead of failing immediately with "control not found".

## 2.85.0 - 2026-11-05
- The extension composer now reacts like the z.ai input box: the card lifts its existing shadow on hover and keeps the focus ring, tier glow and expanded shadow intact, while the send, fill, attach, clear and mapping buttons get short hover/press transitions. Resting colors, shape and layout are unchanged.
- The macOS client composer gains the same interaction motion: the send button scales and blends its accent on hover, presses with a short rebound and animates between enabled, disabled and sending states; the card's border and shadow respond to hover and to the window regaining focus.
- All new motion is skipped when the extension's `prefers-reduced-motion` is set or macOS Reduce Motion is on.
- The AI summary card now sits immediately after the last AI panel instead of at the far right of the layout: its column follows the panels' first row, keeps the 320–460px card width, and leaves any unused layout columns to its right. In a popup window the expanded reading overlay docks to the window's right edge instead of keeping a 24px inset.
- Automatic summaries now start once 70% of a round's answers have finished (was 80%) and at least two have readable text; the options label, READMEs and feature overview say 70%.

## 2.84.1 - 2026-11-05
- Update checks no longer fail when GitHub's REST API is rate limited or unreachable: when `releases/latest` fails, the check reads the version published in `data/version-info.json` from `raw.githubusercontent.com` and compares against that. Both requests now time out after 10 seconds instead of hanging, and the release page remains the download destination.

## 2.84.0 - 2026-11-05
- A panel's first load now starts a blank conversation: when a provider restores its last conversation on the entry page, the panel clicks that provider's own new-chat control and confirms the empty conversation. This runs quietly behind the loading state, is skipped when the panel is already fresh or temporary chat is on, and leaves later in-panel navigation alone.
- New conversation skips providers that already show a blank conversation instead of re-clicking their new-chat control, so a panel on its home screen cannot be sent back to the last conversation.

## 2.83.0 - 2026-11-05
- The Deep thinking mode now appends a critical-analysis brief instead of the step-by-step reasoning instruction: conclusion first, verified facts separated from inference, independent judgment, multi-angle trade-offs, and concrete verification or rollback steps, in Chinese and English. Its menu hint now describes the new instruction.
- Existing libraries get an unedited built-in Deep thinking prompt rewritten in place once per device; user edits and renamed titles are kept, and prompts under another mode are never touched.
- The macOS client's generated prompt definitions and preview test follow the new instruction from the same source of truth.

## 2.82.0 - 2026-11-05
- The AI summary is now the last AI answer: once a summary profile is configured, it stays in the panel grid as a full-height trailing card with the same white frame and header as every AI panel, so it always reads after the AIs and never covers the rightmost one. Without a usable profile the card stays out of the grid, and the toolbar button opens a temporary setup card instead. The card stays last in blind mode, hides with focus mode, and is excluded from panel resize handles.
- The toolbar AI summary button now opens or closes a right-side reading overlay instead of hiding the card; the card itself stays in the grid, Escape or a click outside the overlay collapses it, and the close button only appears on the temporary setup card. The overlay is capped at 520px, floats below the toolbar and above the shared composer, so the rest of the comparison and the input stay visible and usable.
- The result view is static and built for reading: the glass gradient, moving outline, header and verdict sheens, staggered reveals and settle sweep are gone. Only collecting/running keep the skeleton shimmer, progress bar and busy ring.
- Column resize, wide mode, edge scrolling and panel insertion treat the summary as a trailing grid column; adding or removing the last profile shows or hides the card and refreshes the layout while keeping saved column weights unchanged.

## 2.81.1 - 2026-11-05
- Unify macOS client and extension prompt mode definitions into a single source of truth: `scripts/sync-desktop-prompts.js` generates `PromptModeDefinitions.swift` directly from `_locales/zh_CN/messages.json` and `modules/prompts/prompt-modes.js`, eliminating duplicate manual prompt definitions in native source.
- Add `npm run sync:prompts`, build integration in `build-app.sh`, and a unit test assertion to verify that desktop prompt definitions stay synchronized with extension localization files.

## 2.81.0 - 2026-11-05
- Updates and downloads now point at this repository: update checks read the newest published release of `elapse-annals/panelize-plus`, the background commit lookup follows `master`, and the options page's static download link opens this repository's releases. The `panelize-${version}-release.zip` asset name and version comparison rules are unchanged.
- The support prompt after successful sends now invites a GitHub star (`Star` / `去 Star`) and opens this repository in a new tab. The first prompt at 20 successful sends, the 50-send `Later` interval and the dismissed state are unchanged.
- Share snapshots carry the `Panelize Plus` brand and `github.com/elapse-annals/panelize-plus`. On narrow frames the address moves to a second row under the brand name and the caption moves or drops as needed, so the full address is never clipped or overlapped; the extra row is included in the frame height and its estimate.
- Privacy policy and package metadata now name Panelize Plus, this repository, its issues page and its maintainer; the upstream project, license and attribution links are kept.

## 2.80.0 - 2026-11-05
- The macOS client now brings the browser forward as soon as the extension confirms the Multi-Panel page was opened or reused, once per send, and keeps its composer visible while the AIs prepare and while the success result is shown. Losing foreground no longer dismisses it; an outside click, Escape or the shortcut still does.
- The extension reports send progress through a new `sendProgress` bridge event tied to the request: `opening`, `preparing` with ready/total counts and waiting or timed-out AI names, then `sending`. Reports are sent only when the state changes, and repeats, stage regressions or updates after the final result are ignored.
- The composer's status row shows “AI 准备中：3/5”; while sending, the preview row names the AIs still being waited for (or the timed-out ones), shortening long lists while hover and assistive text keep the full list. Blind mode shows counts only.
- Sending from the extension and from the macOS client now uses the same readiness threshold, `ceil(total × 0.7)`; the 20-second timeout, text catch-up sends, and the attachment retry behavior are unchanged.

## 2.79.1 - 2026-11-04
- Organize extension modules, content scripts, tests and release tools by responsibility; split page controllers and ordered styles while preserving direct unpacked loading and existing interfaces.
- Separate macOS composer views, suggestions, layout and bridge transports; add isolated AppKit interaction tests and macOS CI validation.
- Limit Vitest discovery to unit tests and document architecture, script loading and packaged-extension verification.

## 2.79.0 - 2026-11-04
- The macOS client's recent-question suggestions now sit flush above the input card as their own narrower panel, tucked behind the card, with a “Recent questions” header and its own surface and shadow, so the list no longer reads as part of the input box. Pressing Down on the last suggestion returns the highlight to the input.

## 2.78.0 - 2026-11-04
- Starting a new conversation now clears each AI panel's leftover composer draft (text and attachments) after the provider confirms or the confirmation times out, so stale content is not appended to the next question. The unified question box, its uploaded images and content the user starts typing in a panel during the wait are kept.

## 2.77.0 - 2026-11-04
- The macOS composer's footer legend now spells out `Tab 切换模式` instead of the `⇥ 模式` keycap symbol, so the mode-switch shortcut is readable at a glance.
- `Tab` / `Shift + Tab` cycles prompt modes only while the input is empty; with text present, `Tab` no longer changes the mode, so it does not interrupt typing.

## 2.76.0 - 2026-11-04
- AI summary accepts several OpenAI-compatible API profiles, each with its own base URL, API key and model. The summary drawer switches between them; the setting applies to the next summary, and API keys still stay on this device.
- The AI summary settings page manages the profile list, selects the default profile, and saves and tests all profiles at once.

## 2.75.1 - 2026-11-04
- The macOS installer now derives the unpacked extension's ID from the checkout path instead of defaulting to the Chrome Web Store Panelize ID, so the native-host manifest matches the extension this repository loads and Panelize Link connects out of the box.
- The Panelize Link docs explain the derived default and the “This page has been blocked by Chrome” (`ERR_BLOCKED_BY_CLIENT`) page that appears when the manifest's extension ID is not the loaded one.

## 2.75.0 - 2026-11-03
- Panelize Link adds `Control + Space` as a global-shortcut option; `Option + Space` remains the default, and all three shortcuts are selectable from the menu-bar icon.

## 2.74.0 - 2026-11-03
- The macOS prompt-mode picker now shows a distinct SF Symbol for each mode on the picker and in its menu, with a sparkles fallback when a symbol is unavailable.
- The extension composer's controls now share one ghost style: 28px height, 8px radius, 16px icons, consistent purple accents and lighter dividers, with Send All as the only solid primary action.

## 2.73.0 - 2026-11-03
- The macOS composer switches prompt modes with `Tab` and `Shift + Tab`, wrapping at either end; when a trigger completion is showing at the caret, `Tab` still accepts the completion first. The footer legend and the picker's tooltip mention the shortcut.

## 2.72.0 - 2026-11-03
- A summary reply that arrives as Markdown or plain prose now renders as light Markdown in the overview: headings, bullet and numbered lists, fenced code, bold, italic and inline code. Rendering uses text-only DOM APIs, so the drawer stays CSP-safe and no reply can inject markup.

## 2.71.0 - 2026-11-03
- The macOS client now brings the browser running the native bridge to the front once the send result confirms the AIs were ready and received the prompt, so the answers are in view. The browser app identifier comes from the native host's handshake instead of being guessed.

## 2.70.0 - 2026-11-03
- The composer remembers the last three successfully sent questions and offers matching ones above the input as you type a prefix; choosing one fills the input without sending it. Up/Down highlights a suggestion, Enter fills it, and clicking a row works too.
- The macOS client keeps its own last three questions locally in `UserDefaults` and shows the same suggestions above its composer; the history never crosses the native bridge.
- AI summaries are cached locally by question text for three days (at most three). A cached summary is labelled in the drawer, and **Summarize again** bypasses the cache and refreshes it.

## 2.69.0 - 2026-11-03
- The project gained the Chinese name **百家**: the Chinese extension name, settings titles and About text now show `Panelize Plus（百家）`.
- The English, Chinese and Japanese READMEs, plus `NOTICE.md`, now record the Chinese name.

## 2.68.0 - 2026-11-03
- The macOS composer moved the prompt-mode picker to the left of the footer and restyled it as a borderless capsule that sizes to its label, with a single chevron.
- The footer's boxed keycap hints were replaced by a lighter inline shortcut legend.
- The send button now uses the system accent color with a fixed, centered arrow image and no default button title, so it renders as a clean circle instead of text over the icon.
- The composer surface is a lighter near-white tint, and the mode picker carries a purple sparkle accent to match the reference palette.

## 2.67.0 - 2026-11-03
- The macOS composer gained a Spotlight-style soft shadow, a capsule prompt-mode picker, keycap shortcut hints, and a subtle fade/rise animation when it opens or closes.
- The input area now grows from about three to five lines as you type and scrolls beyond that; clearing the prompt or sending collapses it back.
- The send button shows a small progress spinner while sending, and connection status uses a shaped icon (checkmark, exclamation mark, and so on) instead of color alone.
- Added standard editing shortcuts and an Edit menu: Select All, Copy, Paste, Cut, Undo and Redo (Shift-Command-Z).
- The composer now follows Reduce Motion, Reduce Transparency and Increase Contrast; the mode preview is no longer italic.

## 2.66.0 - 2026-11-03
- The macOS client is now named **Panelize Link**: the app bundle, menu-bar quit item, settings text and docs use the new name. The bundle identifier and Native Messaging host name are unchanged, so an existing install keeps its settings.
- Accepting a Tab trigger completion in the macOS composer now appends a space, matching the extension, so you can keep typing the question directly. An existing space after the trigger is not doubled.

## 2.65.0 - 2026-11-03
- When the macOS composer cannot reach the browser, clicking its orange status (or the menu-bar browser status) opens Panelize's settings page at **Enable global input bridge** and highlights the switch; the browser and extension ID come from the installed native-host manifest.

## 2.64.0 - 2026-11-03
- The macOS global composer now opens nearer the bottom of the display and dismisses when you click outside it, including the menu-bar icon.
- In Auto prompt mode, typing a trigger prefix at the end of a line (`/st`) shows a ghost completion (`/study`) at the caret with a shaded `Tab · 学习` hint; Tab accepts it, using the same line-end and whole-word rules as the browser extension.
- The composer gained a dynamic hairline border, a smaller send button with hover, pressed and disabled states, and a compact footer that shows only a green dot when connected.
- Existing installs reset a previously saved prompt mode to Auto once on upgrade; choices made afterwards are kept.

## 2.63.0 - 2026-11-02
- The macOS global composer now previews the selected prompt mode's shipped instruction in a faint italic line under the input, matching the extension's prompt ghost. Auto shows the matched modes or its trigger legend, Default shows nothing, and the Enter/Shift+Enter/Esc shortcut hint stays visible.

## 2.62.0 - 2026-11-02
- New installs now start in Auto prompt mode: a question without a trigger word gets no extra instruction, and an explicitly saved mode is preserved.
- The macOS global composer gained a built-in prompt-mode picker (Auto by default). The choice is saved locally and sent with each prompt, so it applies only to that send without changing the extension's saved mode.

## 2.61.0 - 2026-11-02
- The macOS composer now opens horizontally centered in the lower part of the mouse's current display, follows visible-screen changes, and stays clear of the Dock and menu bar.
- Removed the floating composer's heavy shadow and input focus outlines, while preserving the rounded material, black send button and readable dynamic colors in both light and dark appearances.

## 2.60.0 - 2026-11-02
- The macOS global-input bridge is now opt-in and off by default. Settings > Global Input (macOS) enables it; when off, the extension does not start the native host or keep its heartbeat, avoiding background wakeups.

## 2.59.1 - 2026-11-02
- Provider tier checks no longer post to a panel iframe that is still about:blank, so loading panels stop logging target-origin `postMessage` errors; the check retries once the provider page has loaded.
- Fire-and-forget runtime notifications now consume `lastError`, so a closing message port no longer logs as unchecked.

## 2.59.0 - 2026-11-02
- Added an optional macOS menu-bar client: a global shortcut opens a floating composer and sends the typed prompt through the existing Send All flow, with the same readiness gate and sent-count feedback. It uses a Native Messaging host restricted to Panelize's extension origin; installation and limitations are documented under `desktop/macos/`.

## 2.58.1 - 2026-11-01
- An automatic AI summary now opens the drawer only after a real summary arrives; a failed, timed-out or empty automatic summary stays silent instead of opening an error drawer.

## 2.58.0 - 2026-11-01
- Fresh installs now start from the maintainer's exported configuration: enabled providers, provider order and startup panels follow that backup, wide content is on, Deep thinking is the default prompt mode, AI summary is preconfigured for the Agnes endpoint with agnes-3.0-flash, and doubao/hy-aistudio carry a quota billing marker.

## 2.57.0 - 2026-11-01
- Challenge mode now acts as an adversarial reviewer: it gives a short verdict, restates your claim and assumptions, attacks the weakest or unsupported points with concrete consequences, and ends with sharp clarifying questions. Unedited Challenge prompts update once; customized text stays as is.

## 2.56.0 - 2026-11-01
- The gold speed crown on the fastest answer's top-bar chip is brighter, and the bronze crown on the third-fastest answer is dimmer and recedes, in both light and dark themes.

## 2.55.0 - 2026-10-31
- Top-bar AI chips now share the toolbar width equally (up to 150px each); with many panels they shrink, shorten their labels, and become icon-only instead of overflowing, while a small group stays centered.

## 2.54.0 - 2026-10-30
- Settings > About now shows the author (Ben) and that Panelize Plus is forked from Panelize by Manho, with a link to the upstream project.

## 2.53.0 - 2026-10-30
- The three fastest AIs of the latest question now wear a small gold, silver, or bronze crown on their top-bar chip; crowns appear as each answer finishes, and the chip tooltip shows the rank.
- The AI summary drawer now picks its width by how much the summary says: short summaries open narrow, long ones (or a disagreement with three positions side by side) open wide. The expand button still switches it until the next summary.

## 2.52.0 - 2026-10-30
- Swiping the panel row left or right past the first or last panel now flashes a red bar on that edge once, showing there is nothing further to scroll.

## 2.51.0 - 2026-10-30
- AI summary disagreements now show their positions side by side in columns, each camp in its own color (green, red, then blue for a third), instead of stacked rows; on narrow windows they stack again.

## 2.50.0 - 2026-10-30
- AI chips in the top bar are larger (bigger icons, names, and close buttons) and the top bar is slightly taller, making them easier to read and click.

## 2.49.1 - 2026-10-30
- AI summary no longer shows raw JSON when the model returns slightly malformed JSON (unescaped quotes, raw line breaks, trailing commas, reasoning blocks, or a cut-off reply); the reply is repaired, and if it still cannot be read, its headings and points are shown as plain text.

## 2.49.0 - 2026-10-30
- Locating an AI panel (top-bar chips, AI summary source chips, Alt+number) now runs a soft violet-magenta light once around its border instead of the blue outline flash.

## 2.48.0 - 2026-10-30
- The Popup/Tab Mode and Share buttons in the top toolbar are now icon-only, matching the other toolbar buttons. Their labels remain as hover tooltips and screen-reader text.
- Toolbar icons sit closer together, so the AI chips in the top bar get the freed width and more of them fit before scrolling.

## 2.47.1 - 2026-10-30
- Zhipu (ChatGLM) chips no longer show "Answer complete" while it pauses between thinking, searching and answering; it now waits for its send button to leave the answering state.

## 2.47.0 - 2026-10-30
- AI summary source chips now locate and briefly highlight the quoted passage in the original answer, with paragraph matching for older summaries and panel highlighting when no passage is found.
- Answer stats now classify questions locally, filter results by task category and show the best model per category once enough adopted rounds are available. Answer logs and JSON exports include the category.

## 2.46.0 - 2026-10-29
- Clicking an AI's chip in the top bar scrolls to its panel and briefly highlights it. In focus mode the chip still switches the focused panel.

## 2.45.0 - 2026-10-29
- Provider billing markers in Settings gain a "Rate limited" (限流) option, for platforms that throttle your account.

## 2.43.2 - 2026-10-29
- 文心 (Wenxin), Perplexity and Copilot panels now report answer timing, so their tab chip shows the answering and done animation, and their answers count towards answer stats and the AI summary.

## 2.43.1 - 2026-10-29
- When the summary API is busy (HTTP 429, 502, 503 or 504, such as "The request queue is full"), the AI summary retries twice on its own before failing, and the error now says the API is busy and suggests trying later or another model.

## 2.43.0 - 2026-10-29
- In the AI summary, the "Agreed" paragraphs and their headings sit closer together, so the section is easier to read.

## 2.42.0 - 2026-10-29
- The AI summary streams its reply and shows how long it has been running and how much text has arrived, so a long summary no longer looks stuck. It fails only after the API sends nothing for 90 seconds (or after 5 minutes in all) instead of after 120 seconds no matter what, and says so when it times out.
- Long answers share a 60,000-character budget per summary, so many panels or long replies no longer flood the summary model; short answers are sent whole. The summary is asked to stay concise, which also makes it faster.

## 2.41.0 - 2026-10-29
- Each AI's tab chip at the top shows its state: the icon breathes while the page loads, a blue ring spins while it answers, and a green dot marks a finished answer until the next question. An amber dot means the page never got ready or the answer's end could not be confirmed. Hover a chip for the state in words. AIs whose answers Panelize cannot time show no answering state.

## 2.40.0 - 2026-10-29
- With "Summarize when 80% of answers are done" turned on, the AI summary starts once at least 80% of the AIs have finished answering instead of waiting for the slowest one. AIs still answering are listed as not included; re-run the summary to add them.
- When a summary finishes, a green ring marks the AI summary button until the next question.

## 2.39.0 - 2026-10-29
- Popup mode remembers the window's position, size and maximized state, and reopens there instead of always at 1400×900. Switching from a tab to popup mode uses the same remembered bounds.

## 2.38.2 - 2026-10-29
- Perplexity panels load again for people who also use Perplexity in a normal tab. Its service worker answered the panel's page load with headers that block embedding, so Panelize now removes only that service worker before a Perplexity panel loads and stops panels from registering it again. This adds the `browsingData` permission; cookies and sign-ins are not touched.

## 2.38.1 - 2026-10-29
- The Copilot panel opens copilot.com instead of going blank on Microsoft's sign-in page, which refuses to load inside a panel. Signing in from the panel now opens Microsoft sign-in in a new tab; reload the panel afterwards.

## 2.38.0 - 2026-10-29
- While the AI summary is reading or summarizing answers, a loading ring spins around its toolbar button.

## 2.37.0 - 2026-10-28
- Simplified the interface to Simplified Chinese and English, with Chinese as the default. Existing English preferences are kept; retired language preferences fall back to Chinese.
- Removed the other eight language packs and their prompt-library guides.

## 2.36.0 - 2026-10-28
- Added the Deep thinking prompt mode with `/think` and `/deep` triggers in all languages. Existing users receive the new mode once; modes they deleted stay deleted.
- Grouped New chat, Wide mode and AI summary together in the toolbar, followed by a divider.
- The AI summary uses the question as its compact header, presents agreement as themed paragraphs with inline sources, and groups unique insights by the models that raised them. Copied summaries keep the sections and source groups.

## 2.35.1 - 2026-10-28
- Copilot's embedding rule now only lifts framing protection for frames the panels open, so other websites can no longer frame Microsoft's sign-in pages while Copilot is enabled.
- Blind mode no longer masks the ordinary Chinese word "一言" (as in 一言难尽); only the full name 文心一言 is masked.
- A prompt's English text is no longer sent in place of text you put in the input later: it is forgotten once the input is cleared or filled from elsewhere, such as a page selection.
- Prompt variables are filled in literally, so names with symbols such as `(` or `+` work and values containing `$&` are inserted as typed.

## 2.35.0 - 2026-10-28
- Prompt Library edit buttons are always visible and have a larger 32px click target, with more room beside titles and favorites.
- Added Perplexity, Copilot and Wenxin as optional providers, with site access controls, text fill/send, Enter behavior, shortcuts, blind-mode masking and provider discovery. Image attachments remain disabled for these providers.
- Wenxin embedding, text fill, Send All and Enter sending were verified on its live site. Perplexity and Copilot's signed-in editors and send controls were inspected in Chrome; their embedded sending remains unverified because of Cloudflare and Microsoft sign-in requirements.

## 2.34.0 - 2026-10-28
- Prompts can now carry an English version next to the Chinese one. The Prompt Library, the mode menu, the composer placeholder and the send preview show the Chinese text (the English one when a prompt has no Chinese), while the AIs receive the English text whenever it is set.
- The prompt editor has a second field, "Content (English)"; either text alone is enough to save a prompt, and the English field is optional.
- Picking a prompt with both texts fills the input with the Chinese text and sends the English one; edit the text and what you typed is sent instead.
- Prompt search matches the English text too, and a mode that only has English text still appears in the mode menu.

## 2.33.0 - 2026-10-28
- "Import Default Prompts" in Options now adds only the built-in prompt modes (Concise, Learning, Challenge, Brainstorm) that your library lacks, instead of the 70 sample prompts.
- Sample prompts imported again after the earlier cleanup are removed once more. As before, only samples still exactly as shipped go; prompts you edited or favorited stay.
- Each card in the Prompt Library has an Edit button in its top-right corner, shown on hover or keyboard focus. Clicking a card still inserts the prompt.

## 2.32.0 - 2026-10-28
- In Auto mode, typing the start of a trigger word such as `/st` shows the rest (`udy`) faded at the caret, followed by a quiet "Tab · Learning" hint. Press Tab to complete it to `/study ` and keep typing; without a suggestion, Tab moves focus as before. Suggestions appear only at the end of a line and follow the mode menu's order.

## 2.31.0 - 2026-10-28
- The AI summary drawer now sits between the toolbar and the composer instead of covering them, and is wider: 560px normally and up to 1080px when expanded.
- Summary text is easier to read: larger type and line spacing, one point per row with its AIs on a quiet row below instead of mixed into the sentence, and no more whole paragraphs in bold. A point every summarized AI backs shows one "All N AIs" badge instead of a chip per AI.
- Disagreements now list only positions that contradict each other. A point some AIs simply did not mention is not a disagreement; it goes to the new Unique insights section with the AIs that raised it. Each position is one row followed by the AIs that hold it.
- Summary text no longer shows stand-in ids such as S1 or S2: the AI is asked not to write them, cited ids in brackets are removed, and any left are replaced by the AI's name.

## 2.30.0 - 2026-10-28
- The AI summary drawer no longer widens when the pointer passes over it; hovering only makes it solid. Click anywhere in it (outside its buttons and source chips) to widen it, and click again to narrow it. The new Expand button in its header does the same and works from the keyboard. The cursor shows which way a click goes, selecting text does not toggle the width, and the drawer keeps its width when you close and reopen it.

## 2.29.0 - 2026-10-28
- In the AI summary, consensus points and disagreement positions backed by at least 80% of the summarized AIs are shown in bold with a stronger highlight.

## 2.28.0 - 2026-10-28
- The AI summary is laid out as verdict, agreement and disagreement: for a yes-or-no or which-is-better question it states the answer first, then lists what the AIs agree on, then each disagreement with up to three positions side by side, each citing its AIs. Copy uses the same sections. Summaries made before still show.
- The AI summary drawer widens while you hover over it or work in it, and has a cleaner look in light and dark themes.
- The drawer grows out of the AI summary button when it opens and shrinks back into it when it closes. Clicking anywhere outside it, including inside a panel, closes it. With reduced motion turned on, it opens and closes without animation.

## 2.28.0 - 2026-10-28
- Sending no longer waits for every AI: once 80% of them are ready (rounded up), Send All and Fill work again. AIs still loading are skipped; a text question reaches each of them once it is ready, and with files attached they join Retry Failed.
- The Prompt Library button and the prompt-mode menu now sit together at the start of the composer row.
- The prompt-mode menu is a proper menu: Default, Auto, then Concise, Learning, Challenge and Brainstorm, followed by your own modes. Each mode has Edit and Delete, and New mode opens the editor with "Prompt mode" already checked. A mode listed twice in the library shows once.
- The Auto hint lists each mode's first trigger word only, such as `/brief Concise · /study Learning`.
- The sample prompts added by an earlier "Import default library" are removed once, so the library starts from the prompt modes. Prompts you edited, favorited or wrote yourself stay; Options can still import the samples again.

## 2.27.0 - 2026-10-28
- Panelize now shows whether the AIs are ready when the page opens, when you add or switch a panel, and when a new temporary chat reloads panels: a status above the composer counts the AIs whose question box has loaded and names the ones still loading. In blind mode it shows counts only.
- Sending is paused until every AI is ready, like when new chats are starting: Send All and Fill look unavailable, and Enter keeps your draft and explains why. An AI that has not shown its question box after 20 seconds (for example when signed out) stops holding sending and is listed as not ready.

## 2.26.0 - 2026-10-28
- The AI summary drawer is translucent so the panels stay visible behind it; it turns solid while you hover over it.
- Once a round finishes, the AI summary button rings to remind you, if an API is set up. The ring clears when you open the summary.
- Prompt Library has a "Restore built-in modes" button that adds back built-in modes you deleted, such as Learning or Brainstorm. Modes are read from the library only, so edits there apply to the prompt-mode menu right away.
- Auto mode also matches trigger words that touch Chinese text or punctuation, such as `/study，` or `问题/study`. Paths and URLs such as `https://x.com/study` still do not match.
- The composer shows a faded one-line preview of the instruction that will be appended, right where your question ends, and in Auto mode strikes through the trigger words that are removed, so you can see what the AIs receive. The preview never changes the input's height and does not take pointer input.

## 2.25.0 - 2026-10-28
- New AI summary: once every AI in a round finishes answering, Panelize can merge their answers into one summary through an OpenAI-compatible API you set up in Options (API base URL, API key and model). Each point and disagreement shows chips naming the AIs it came from; clicking a chip scrolls to that panel. In blind mode the chips number the panels instead of naming them, and the API sees the same anonymous labels.
- The summary opens in a side drawer from the new AI summary toolbar button (Mod+Alt+Y by default), which can also re-run it and copy it with its sources. Automatic summaries are off until you turn on "Summarize when all answers are done". For AIs whose answer was not captured when it finished, the drawer reads their last answer when you open or re-run it; ones that still cannot be read are listed as not included.
- The API key stays on this device only and is never synced or exported. "Save and test" asks for access to the API's site only, and answer texts stay in memory and are not added to answer stats.

## 2.24.0 - 2026-10-28
- The prompt-mode menu has a new Auto choice: nothing is added unless the question contains a mode's trigger word, and then that mode applies to this send only. Typing `/study` uses Learning, `/brief` Concise, `/brainstorm` Brainstorm and `/challenge` Challenge; several trigger words combine their modes. The trigger word is removed from the question the AIs, answer stats and snapshots see.
- Prompt Library prompts marked as modes now have a Trigger words field, and the list shows each mode's trigger words. Built-in modes already in your library get their default trigger words once; trigger words are kept in prompt export and import.

## 2.23.0 - 2026-10-28
- Default settings follow the maintainer's preferred setup: Qwen (global) moves to the end of the default enabled providers, and wide content is off by default.

## 2.22.1 - 2026-10-28
- New Chat on Doubao no longer opens the Create Project dialog: project controls are skipped, and when the sidebar is collapsed it uses the header's new-chat control or loads a new chat page.

## 2.22.0 - 2026-10-28
- Prompt modes now live in the Prompt Library: Learning, Concise, Brainstorm and Challenge are added there once as prompts marked as modes, and you can edit their wording, delete them or mark any prompt as a mode. The mode menu lists only prompts marked as modes.
- With a mode selected, the question box's placeholder shows the instruction that will be appended.
- The Competitive mode is renamed Challenge (竞争 → 挑战). A mode chosen before this update stays selected.

## 2.21.1 - 2026-10-28
- Send All with images or files attached now sends: each AI gets the attachments and the question and then sends, waiting until its upload finishes, instead of stopping after filling the question box. Fill still only fills. AIs that cannot take a file still get the text without sending, and retrying them sends once their files are in.

## 2.21.0 - 2026-10-28
- The reasoning level is now one button that shows the current level and opens a menu of Default, Fast, Balanced and Deep, each with what it does and its shortcut. Default has its own shortcut too.
- Every toolbar and composer button now has a keyboard shortcut and shows it on hover. New shortcuts open Answer stats, Answer log, Settings and Keyboard shortcuts, toggle temporary chat, blind mode and the toolbar, share a snapshot, clear inputs, attach files, add a panel and choose a layout; all can be changed or cleared. Shortcuts you set earlier keep their keys.
- Clicking a button with the mouse briefly shows its shortcut above it.
- Typing right after Panelize opens no longer ends up in an AI panel: when a loading page grabs focus, the keys it catches go to the question box instead, and Enter is never sent there. Clicking a panel still lets you type in it.

## 2.20.1 - 2026-10-27
- Answer notifications only appear when you have switched away from Panelize, and clicking one returns to the Panelize page that asked the question even when several are open. They never name the AI of a blind question, and they are removed when that page closes.
- A prompt mode now also applies when you send files without text, and retrying the panels that failed a file fill keeps the mode the fill started with.

## 2.20.0 - 2026-10-27
- A new prompt mode next to the reasoning levels appends a short instruction to every question you send, without changing the question itself: Learning (conclusion first, then the reasoning, with questions to check you), Concise (conclusion and key points only), Brainstorm (several angles, no early verdict) and Competitive (aim to win the side-by-side comparison). Answer stats and shared snapshots still show your original question, and the choice is remembered.
- The Prompt Library closes with Esc; the prompt editor and variable dialogs keep Esc so unsaved text is not lost.
- The composer is less crowded: the reasoning levels are narrower, and AI mode mapping is now a small light "i" instead of a sliders icon.

## 2.19.0 - 2026-10-27
- Panelize now shows a system notification when the first AI finishes answering a question, once per question, so you can switch away while you wait. Clicking it brings Panelize back. In blind mode the notification does not name the AI.
- Turn it off in Options with "Notify when an answer is done". Claude, StepFun, Agnes and Hy AI Studio do not report when they finish, so they never trigger it. The extension now asks for the notifications permission.

## 2.18.1 - 2026-10-27
- Starting new conversations no longer pulls focus out of the question box partway through: it stays there while the AIs confirm their new chats and restore reasoning levels, and for a few seconds after, so you can keep typing. Clicking into a panel still lets that panel keep focus.

## 2.18.0 - 2026-10-27
- The upload button now attaches files as well as images: PDF, Word, Excel, PowerPoint, text, Markdown, CSV, JSON and common code files, by picking, pasting or dropping them (up to 10, 20MB each). Files show as cards with their name.
- ChatGPT, Claude, Gemini, Grok, DeepSeek and Kimi receive files. Other AIs take images only; for them a file fill fails right away, their text is still filled but not sent, and you can retry.

## 2.17.1 - 2026-10-27
- Blind mode no longer flickers: each provider page now stays reduced to its answers and the same empty composer box, instead of switching back to the provider's own page on every page change or focus change, which also left panels looking different from one another.
- In blind mode, Doubao no longer shows a second empty box where its composer used to be, Google AI Mode's box sits at the bottom like the others instead of halfway up, and pages no longer show their own scrollbars, so every panel looks the same.

## 2.17.0 - 2026-10-27
- The composer's placeholder now starts with the focus-input shortcut, so you can see how to jump to the question box (hidden when page shortcuts are off).

## 2.16.0 - 2026-10-27
- Answer stats now time Qwen (Global), Grok, Meta AI, Doubao and Google AI Mode answers too.
- Signed-in ChatGPT answers are timed again; before, ChatGPT's current signed-in page was not recognised, so its answers timed out and lost 5 points.
- The Answer stats explanation now names the providers that are not timed (Claude, StepFun, Agnes and Hy AI Studio).

## 2.15.0 - 2026-10-27
- The composer's placeholder now shows its keys: Enter sends, Shift+Enter adds a line, and the fill shortcut fills without sending (hidden when page shortcuts are off).
- Composer buttons now explain what they do on hover, below the name and shortcut: Send All, Fill, the reasoning levels, Prompt Library, Upload images, Clear all inputs, Keyboard shortcuts and AI mode mapping.

## 2.14.0 - 2026-10-27
- Answer stats no longer deduct for a timed answer that timed out without text when timing may simply have missed it; it only counts as a timeout. It costs points only when the provider's previous and next timed answers both showed text, and such confirmed failures lose 5 × log₂(1 + n) points per 30-day window instead of 5 each.

## 2.13.0 - 2026-10-27
- Answer stats now time Zhipu, Z.ai and MiMo answers (first output, completion and timeouts) instead of showing —.

## 2.12.1 - 2026-10-27
- Answer log now lists questions when the extension language has a region (for example Simplified Chinese); before, it stayed empty.
- ChatGPT answer timing works with ChatGPT's current page, so its answers no longer all time out in Answer stats.
- A timed answer that times out without detected text no longer loses 5 points when you adopted it or clicked or scrolled in it, since it clearly had output. Existing stats are recalculated with this rule.

## 2.12.0 - 2026-10-27
- A horizontal trackpad swipe over a panel scrolls the panel row again, while still never going back or forward inside the panel. Wide code blocks and tables in a panel keep their own horizontal scroll.
- The New conversation button below the composer is hidden; use New Chat in the toolbar or its shortcut.
- In blind mode every panel's composer is now the same empty box, so its buttons and size no longer hint at the provider.

## 2.11.0 - 2026-10-27
- The question history moves out of Answer stats into its own Answer log dialog (toolbar button next to Answer stats), with search and filters by AI and by feedback.
- Answer stats keeps the table; its explanations fold into "How these are calculated", and the header row and AI column stay visible while the table scrolls.
- While either dialog is open, timing and engagement updates redraw from memory at most every 250 ms instead of rereading all stored questions each time.

## 2.10.1 - 2026-10-26
- The "Plus" gradient in the toolbar title moves three times slower and uses softer colors, so it draws less attention.

## 2.10.0 - 2026-10-26
- "Plus" in the toolbar title now shows a flowing purple gradient (static when reduced motion is on).

## 2.9.0 - 2026-10-26
- The New Chat result now floats above the composer instead of taking height from it. It hides on its own after a full success and has a close button.

## 2.8.0 - 2026-10-26
- When panels overflow horizontally, light buttons on the left and right edges jump to the first or last panel. Option+Left / Option+Right (Alt+Left / Alt+Right) do the same outside text fields and in an empty composer; with text in the composer they still move by word.

## 2.7.0 - 2026-10-26
- The top toolbar is shorter, and its AI chips are smaller and show short names (for example GPT, DS, Gem). Hover a chip to see the full name.

## 2.6.2 - 2026-10-26
- Qwen (Global) New Chat is confirmed again when the panel is already on a blank chat; its fresh chat now lives at the site root.

## 2.6.1 - 2026-10-26
- A horizontal trackpad swipe in a panel (notably Gemini) or on the Multi-Panel page no longer navigates back to the previous page.

## 2.6.0 - 2026-10-26
- The bottom composer is narrower (up to 960px) so it sits more centered on wide windows.

## 2.5.1 - 2026-10-26
- Panel notes now appear as soon as Multi-Panel opens, not only after a note is edited.
- Doubao New Chat no longer waits out its timeout when a floating hint sits over the composer, and it stops trying to close a stuck overlay after a few attempts.
- In blind mode, ChatGLM login and confirmation dialogs stay visible while its sidebar is hidden.

## 2.5.0 - 2026-10-26
- Jump straight to a panel with Ctrl+Shift+1–9 (in display order, including blind-mode shuffles). New toolbar buttons and Cmd/Ctrl+Alt+, / . scroll to the first or last panel. All are customizable under Keyboard shortcuts.
- Add a one-line note after any AI's name in its panel header (for example "great for brainstorming, very slow"). Click it to edit. Notes sync with your settings and are hidden in blind mode.
- The toolbar, panel headers and composer take less vertical space, so the panels get more room. The composer now rests at one line and grows as you type.
- While new conversations are starting, Send and Fill are visibly paused. Pressing them explains why, and you can keep typing your draft.
- Blind mode now also hides the ChatGLM and Z.ai sidebars.
- New Chat on Doubao no longer leaves the sidebar drawer or a mask overlay open in narrow panels, and no longer reports success while the composer is covered.

## 2.4.0 - 2026-10-26
- Enabled providers that still need site access on this device are now listed at the top of AI Providers in Settings, with one Grant access button that asks for all of them in a single browser prompt. Settings also opens after a fresh install so the default providers can be granted right away.

## 2.3.0 - 2026-10-26
- New installs and Reset now start with an updated default setup: 12 enabled providers (ChatGPT, Gemini, DeepSeek, Meta AI, MiMo, Doubao, Yuanbao, Grok, Qwen Global, Z.ai Global, Google and ChatGLM), a new provider order and startup panels, wide content turned on, and Hy AI Studio marked as quota billing. Existing settings are unchanged.

## 2.2.0 - 2026-10-26
- Added Tencent Hy AI Studio (aistudio.tencent.com) as an optional provider with text fill, Send All and Enter to send. It also needs access to api.hunyuan.tencent.com so the panel stays signed in.

## 2.1.0 - 2026-10-26
- Mouse back and forward buttons no longer navigate provider panels away from their chats by accident.

## 2.0.1 - 2026-10-23
- The extension name and summary now describe what Panelize does, in all 10 supported languages.

## 2.0.0 - 2026-10-22
- Added Share: turn your comparison into an image to copy or download, with the prompt as an editable title. Choose Current view, or Full answers to stitch each answer from your latest prompt down.
- Provider pages wider than their panel (such as Kimi, Qwen and Zhipu in narrow layouts) are now scaled down to fit instead of being cut off.
- Resize panel columns by dragging their edges or with the arrow keys. Widths are remembered per layout, and a double-click resets them.
- Added a one-time prompt asking engaged users to rate Panelize on the Chrome Web Store, with Later and Never options.

## 1.3.3 - 2026-10-16
- Fixed Grok conversations failing to start in panels by forwarding your existing grok.com session to Grok inside the Multi-Panel page.
- Fixed Grok cookie consent choices not being saved inside panels.
- Fixed Qwen Global staying signed out in panels. Existing Qwen Global users need to approve the additional qwen.ai access once in Settings.

## 1.3.2 - 2026-10-02
- Fixed New Chat for All opening a citation link in Claude answers instead of starting a new chat.

## 1.3.1 - 2026-09-29
- Fixed Send All, Enter to send and focus toggle for the current ChatGPT composer.
- Fixed the next Enter after an image fill sending from only one panel instead of all of them.
- Fixed a click into a panel sometimes being pulled back to the unified input after Send All.

## 1.3.0 - 2026-09-24
- Added Tencent Yuanbao as an optional provider with text fill, Enter to send, new chat, image upload and temporary chat.
- Fixed Send All and New Chat for DeepSeek with its current site controls.
- Fixed New Chat for All on Doubao and Qwen with their current site controls.
- Fixed the first click into a panel being pulled back to the unified input right after Send All.
- Fixed image fill for Kimi and Google AI Mode with their current upload controls.

## 1.2.9 - 2026-09-22
- Fix Doubao text injection for the current TipTap/ProseMirror composer.

## 1.2.8 - 2026-07-19
- Fix Gemini Send All in localized interfaces without affecting image uploads.

## 1.2.7 - 2026-07-17
- Removed the experimental Claude model override now that Claude provides native model selection when embedded.
- Added upgrade cleanup and regression coverage for the retired Claude model preference.

## 1.2.6 - 2026-07-17
- Fixed update checks for GitHub-installed extensions using GitHub Releases.
- Added a guarded release workflow that publishes only after the release branch is merged into main.

## 1.1.1 - 2026-04-13
- Fixed: New Chat for All now preserves temporary chat mode for supported providers.
- Fixed: Gemini and Grok temporary or private chat activation no longer toggles off when already active.
- Fixed: Grok private new-chat detection now avoids offscreen controls in narrow layouts.

## 1.1.0 - 2026-04-07
- Added: One-click temporary chat toggle for supported providers in multi-panel. (#39)
- Added: Global Google mode sync with AI/Search mode switching and repeat send/fill fixes. (#37)
- Fixed: Unified input focus retention after `New Chat for All` and `Send All`. (#36, #38)
- Fixed: Focus trap caused by iframe loading state leaking during multi-panel interactions. (#39)

## 1.0.3 - 2026-03-05
- Fixed: Enter key on standalone Gemini page now works correctly (no longer triggers sidebar menu). (#35)
- Fixed: IME composition Enter key sending message prematurely in multi-panel. (#31)
- Docs: Added zh-CN and ja READMEs with updated store link. (#30)

## 1.0.0 - 2026-02-03
- Multi-panel workspace with flexible layouts up to 1x7.
- Unified input bar to send or fill prompts across all panels.
- Prompt library with import/export, tagging, and variable templates.
- Provider management and per-provider Enter key behavior.
- Context menu send with optional local page content extraction.
- Multilingual UI (10 languages).
- Update checks via GitHub.
