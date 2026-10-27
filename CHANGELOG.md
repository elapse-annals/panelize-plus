# Changelog

## 2.17.1 - 2026-10-27
- Blind mode no longer flickers: each provider page now stays reduced to its answers and the same empty composer box, instead of switching back to the provider's own page on every page change or focus change, which also left panels looking different from one another.
- In blind mode, Doubao no longer shows a second empty box where its composer used to be, Google AI Mode's box sits at the bottom like the others instead of halfway up, and pages no longer show their own scrollbars, so every panel looks the same.

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
