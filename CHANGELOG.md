# Changelog

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
