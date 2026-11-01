# Panelize Plus codebase inventory (read-only pass)

Repo: `/Users/ben/Code/Personal/elapse-annals/panelize-plus` (fork of Manho/Panelize). Branch `master`, HEAD `d46007b` (2.42.0). Working tree holds uncommitted work for 2.43.0–2.47.0 (24 modified files, 3 untracked: `modules/task-category.js`, `tests/task-category.test.js`, `tests/locate-answer-content-script.test.js`). `manifest.json` and `package.json` read 2.47.0 in the working tree; HEAD is 2.42.0. Nothing was edited, staged or committed. Paths below are repo-relative. "CL x.y.z" means the entry in `CHANGELOG.md`.

Unverified scope: I did not run the test suite, did not load the extension, and did not inspect `.delta/clones/` or the stale worktree `.claude/worktrees/mystifying-archimedes-ae366c` (branch `claude/mystifying-archimedes-ae366c` at `ee9e9b3`, not on master).

---

## 1. What user-facing features exist today

### Takeaway
Panelize Plus is a MV3 Chrome/Edge extension that embeds 20+ AI chat sites in one grid, sends one prompt to many of them, and layers comparison aids on top (timing, adoption, AI summary, shareable image, prompt modes). Most features shipped in 2.18–2.42 (Oct 2026). The UI is now zh_CN (default) and en only (CL 2.37.0).

### Core comparison
- Multi-panel grid of provider sites in iframes, layouts up to 30 panels; README says "49 layouts" and "up to 30 panels" (`README.md` Features). CL 1.0.0 said "up to 1x7" (superseded; CL 6ca9a53 "ten-panel layouts").
- Unified composer: Send All, Fill (no send), Retry Failed, Clear all, Enter-to-send with presets (Default/Swapped/Slack/Discord/Custom) (`options/options.html` Enter section; `multi-panel/multi-panel.html` composer ids).
- New Chat for All, with readiness gate: sending waits until 80% of AIs are ready; a status row names loading AIs; 20-second cap per AI (CL 2.27.0, 2.28.0; CL 2.5.0 "Send/Fill visibly paused").
- Temporary/private chat toggle across supported providers (CL 1.1.0).
- Panel focus mode (enlarge one panel) (commit ec5fcf5); edge jump buttons and Option+Arrow (CL 2.8.0); Ctrl+Shift+1–9 jump (CL 2.5.0); trackpad horizontal swipe over panel row (CL 2.12.0, 2.6.1).
- Resizable panel columns, widths per layout, double-click reset (CL 2.0.0).
- Provider-side width fit: wide provider pages scaled to fit (CL 2.0.0); "Wide content" toggle, default off (CL 2.23.0).
- Per-panel one-line notes shown after provider name, hidden in blind mode (CL 2.5.0; `modules/settings.js` `providerNotes`).
- Popup window mode with remembered bounds (CL 2.39.0); Tab vs popup open mode (`options/options.html`, `openMode`).
- Provider order: manual or "Most used" sort by answer score (`modules/provider-ranking.js`, `providerSortMode`).
- Startup providers: choose panels that open on launch; parallel startup load (CL 2.4.0, perf commit 3c230b8).
- Provider tiers / reasoning level mapping: Default / Fast / Balanced / Deep applied to each open panel via per-site recipes; editable in Options; Grok and Google unmapped (`docs/provider-modes.md`; CL 2.21.0).
- Blind mode: anonymized "Anonymous model" labels, shuffled panel order, neutral page style, hides answer stats and notes (commits e9436cd, 5cafb08; CL 2.17.1).
- Per-provider billing markers (free/paid/quota/credits/limited) set by user; defaults for claude, stepfun, agnes, hy-aistudio (`modules/provider-billing.js`; CL 2.45.0 added "Rate limited").
- Blocks mouse back/forward inside panels (CL 2.1.0; commit 9a10d84).

### Providers (`modules/providers.js` ids; `manifest.json` content_scripts)
Default-enabled (CL 2.3.0): ChatGPT, Gemini, DeepSeek, Meta AI, MiMo, Doubao, Yuanbao, Grok, Qwen (Global), Z.ai (Global), Google, ZhiPu (ChatGLM). Optional with per-site access grant: Kimi, Claude, Qwen (China), StepFun, Agnes, Hy AI Studio, Perplexity, Copilot, Wenxin (CL 2.2.0, 2.35.0; `manifest.json` `optional_host_permissions`). Claude is embedded via its own site (CL 1.2.7 removed a Claude model override). Note: `providers.js` ids include `wenxin` and `copilot` but Perplexity/Copilot/Wenxin image attachments are disabled (CL 2.35.0).

Per-provider capability matrix (sources: CL entries; `modules/*`):
- Text fill + send: all providers, with per-site selectors in `content-scripts/text-injection-*.js` and `enter-behavior-*.js`.
- File attachments (PDF/Office/text/code, up to 10 files, 20 MB each): ChatGPT, Claude, Gemini, Grok, DeepSeek, Kimi only; others get text without send (CL 2.18.0).
- Images: most providers; not Perplexity/Copilot/Wenxin (CL 2.35.0).
- Response timing for Answer stats: ChatGPT, Gemini, DeepSeek, Kimi, Qwen CN/Global, Yuanbao, ChatGLM, Z.ai, MiMo, Grok, Meta AI, Doubao, Google, Wenxin, Perplexity, Copilot (`modules/answer-stats.js` `ANSWER_TIMING_PROVIDER_IDS`, which is WIP). Not timed: Claude, StepFun, Agnes, Hy AI Studio (CL 2.16.0 explanation text).
- Finish notification: not reported by Claude, StepFun, Agnes, Hy AI Studio (CL 2.19.0).
- Tier recipes: not Grok, not Google (`docs/provider-modes.md`).

### Prompt tools
- Prompt Library: favorites, categories, tags, search, recent list, variables such as `{topic}`, import/export JSON; card edit button (CL 2.33.0; README "Prompt Library"; PRIVACY.md).
- Prompt modes (appended instruction, not visible in the question): Default, Auto, plus built-in Concise, Learning, Challenge (was "Competitive", renamed CL 2.22.0), Brainstorm, Deep thinking (CL 2.36.0 `/think` `/deep`). Modes are prompts in the library with "Prompt mode" checked; built-ins are re-addable via "Restore built-in modes" (CL 2.26.0). Mode menu has edit/delete (CL 2.28.0).
- Auto mode: trigger words (e.g. `/study`, `/brief`) apply a mode to one send and are stripped from the question; Tab completes trigger words at caret (CL 2.24.0, 2.32.0; CL 2.26.0 Chinese-adjacent matching).
- Bilingual prompt text: Chinese shown, English sent (CL 2.34.0, 2.35.1).
- Prompt variables: `{name}` dialog (CL 2.35.1 literal fill).

### Answer Stats and Answer Log (local comparison data)
- Answer stats dialog: per-provider median first output/complete time, timeouts, adoption rate, engaged time, score over 30-day window with older points at 30% (CL 2.11.0, c169559, b2517e9). Score rules in `modules/answer-stats.js` header: adopted +5, rejected -5, confirmed no-output timeout -5*log2(1+n), engagement up to +3.
- Adopt a panel's answer (button in panel header), reject with point deduction (`multi-panel/multi-panel.js` `rejectButton`; `tests/answer-stats.test.js`).
- Answer log dialog: searchable history grouped by day, filter by AI and feedback (adopted/rejected/none), 20 per page (CL 2.11.0, c169559).
- Export answer stats as JSON (`multi-panel/multi-panel.js` `exportAnswerStats`, line ~5001); clear stats button.

### AI Summary (optional, needs user-configured OpenAI-compatible API)
- Merge all answers of a round into verdict / consensus / unique insights / disagreements, with per-point source chips linking to panels (CL 2.25.0, 2.28.0, 2.31.0). Blind rounds use anonymous labels also sent to API (CL 2.25.0).
- Drawer, expand/collapse width, copy with sources, re-run, Mod+Alt+Y shortcut (CL 2.25.0, 2.30.0).
- Auto summary when 80% of answers are done; button ring on completion (CL 2.26.0, 2.40.0).
- Streaming with 90s idle timeout and 5-min cap; 60,000-char combined answer budget; 20,000 per answer (CL 2.42.0; `modules/ai-summary.js` constants).
- Retry twice on 429/502/503/504 (CL 2.43.1, uncommitted; see section 2.3).
- Save and test: requests host permission for the API origin only (CL 2.25.0; `options/options.html` L220–224).

### Share snapshot
- Capture the comparison as PNG: toolbar icon/shortcut/context menu snapshot via `captureVisibleTab`, or `getDisplayMedia` fallback; light/dark layouts; editable title; watermark toggle; "Full answers" stitches panels lock-step up to 8000 px (CL 2.0.0; eb2c35c body).

### Other
- Desktop notification when first AI in a round finishes; click returns to page; blind mode does not name AI; toggle in Options (CL 2.19.0, 2.20.1).
- Rating prompt: after 20 successful Send All, "Rate / Later (snooze 50 sends) / Never" banner (CL 2.0.0; `modules/rating-prompt.js` L8, L11).
- Keyboard shortcuts: every toolbar/composer button has a configurable shortcut (CL 2.21.0; `modules/keyboard-shortcuts.js`).
- Reasoning level menu and shortcuts (CL 2.21.0).
- Update check against GitHub Releases (CL 1.2.6; `modules/version-checker.js`).
- Settings sync: user settings use `chrome.storage.sync` with local fallback (`modules/settings.js`).
- Context menu "Send to Panelize" with optional local page content extraction (CL 1.0.0; `background/service-worker.js` L190–196).
- Themes: auto/light/dark (`options/options.html`).
- Language: zh_CN default, English only (CL 2.37.0). `_locales/en` has 559 message keys and `_locales/zh_CN` 552 (working tree, counted by `node -e`); parity not verified.

---

## 2. Uncommitted work in progress (working tree vs HEAD)

Status: all of 2.43.0–2.47.0 is uncommitted (HEAD CHANGELOG top is 2.42.0; `git show HEAD:CHANGELOG.md`). There is no CL entry for 2.44.0; the version sequence goes 2.43.2 -> 2.45.0.

### 2.1 Task categories for answer stats (CL 2.47.0; new file `modules/task-category.js`)
- Rule-based, bilingual regex classifier: `translation` > `coding` > `writing` > `qa` > `other`. Also a high-symbol-density heuristic for code.
- Stored on each round (`modules/answer-stats.js` `createRound`, `category` field, derived on read by `getRoundCategory` for old rounds). Caller `multi-panel/multi-panel.js` ~L4038.
- Surfaced: category filter `#answer-stats-category`; "best model per category" chips (`renderBestByCategory` in `modules/answer-stats-view.js`, `summarizeBestByCategory` needs >=3 decided rounds); category label in Answer log (`modules/answer-log.js`); JSON export includes category.
- Tests: `tests/task-category.test.js`, `tests/answer-stats.test.js` (+58 lines), e2e `tests/e2e/answer-stats.e2e.test.js`.
- Not stored: the reasoning tier, prompt mode, or the trigger word per round. `createRound` gets only id, createdAt, question text, panels, blind flag, category (`multi-panel/multi-panel.js` ~L4034–4041). So answer stats cannot be split by tier or prompt mode today.

### 2.2 AI summary source quotes and locate-in-answer (CL 2.47.0)
- Summary JSON now requests a `quotes` object per source, each excerpt <=120 chars (`modules/ai-summary.js`; `SUMMARY_QUOTE_MAX_LENGTH`).
- Chip click scrolls to the panel (`jumpToPanel`) and sends `PANELIZE_LOCATE_ANSWER_TEXT` to the provider frame; `content-scripts/text-injection-all-providers.js` finds the passage with a normalized innerText view, highlights it for 2500 ms (`panelize-quote-highlight` CSS injected by content script), and replies `PANELIZE_LOCATE_ANSWER_RESULT`. Locate timeout 1500 ms (`multi-panel/multi-panel.js` `AI_SUMMARY_LOCATE_TIMEOUT_MS`).
- Fallback matching: exact whitespace-normalized quote, then longest common substring (min 12 chars, or 6 for CJK), then bigram-overlap window of up to 160 chars (`modules/ai-summary.js` `findQuoteInText`, `getBoundedAnswerAnchor`, `pickAnchorText`).
- Locate highlights for older summaries via paragraph matching; CL 2.47.0 says panel highlight when no passage is found.
- Test: `tests/locate-answer-content-script.test.js`, `tests/ai-summary.test.js`, `tests/e2e/ai-summary.e2e.test.js`.

### 2.3 Busy-API retry (CL 2.43.1)
- `AI_SUMMARY_RETRYABLE_STATUSES = [429,502,503,504]`, delays 2 s and 5 s, Retry-After capped at 10 s (`modules/ai-summary.js`). Error text "The summary API is busy..." (`multi-panel/multi-panel.js` `aiSummaryBusy`).

### 2.4 Timing for Wenxin, Perplexity, Copilot (CL 2.43.2)
- Selectors in `content-scripts/text-injection-all-providers.js` (wenxin `.answer-box .chat-search-answer-generate-item`, perplexity `div.prose[data-renderer="lm"]`, copilot `[data-testid="markdown-reply"]`). Settle times 3–5 s. Added to `ANSWER_TIMING_PROVIDER_IDS`.

### 2.5 "Rate limited" billing marker (CL 2.45.0)
- `modules/provider-billing.js` adds `limited` type; locale `billingLimited`.

### 2.6 Chip click scrolls and flashes panel (CL 2.46.0)
- `multi-panel/multi-panel.js` `jumpToPanelElement`.

### 2.7 Other WIP files
- `content-scripts/text-injection-all-providers.js` +173 lines; `multi-panel/multi-panel.css` +77; `multi-panel/multi-panel.html` +15; `_locales/*` +36 each (keys: `answerStatsCategoryLabel`, `answerStatsCategoryAll`, `taskCategory*`, `answerStatsBest*`, `billingLimited`, `aiSummaryBusy`).

---

## 3. Data collected and stored locally

| Data | Where | Retention | Surfaced? | Evidence |
|---|---|---|---|---|
| Settings and preferences (providers, order, shortcuts, theme, language, blind, wide, notes, Enter behavior, tier recipes, billing markers, layout/popup bounds) | `chrome.storage.sync`, local fallback | until reset | yes | `modules/settings.js` DEFAULT_SETTINGS; PRIVACY.md |
| Prompt library (title, content EN/ZH, category, tags, favorites, usage, lastUsed, trigger words, mode flag) | extension storage | until deleted | yes | `modules/prompt-manager.js` (lastUsed query ~L426); CL 2.34.0, 2.24.0 |
| Answer rounds: question summary (<=100 chars), panels, per-answer timing phases (first output, complete, timeout, cancelled), adoption, rejection, engagement counts (clicks, scrolls, zoom in/out), active time, category (WIP), blind flag | IndexedDB `PanelizeAnswerStatsDB`, store `rounds`, cap 1000 | 30-day recent window; older points at 30% | yes (stats, log, export) | `modules/answer-stats.js` header, `MAX_STORED_ROUNDS`; PRIVACY.md "Answer Statistics" |
| Engagement counts per answer (clicks/scrolls/zoom) | inside round answers | same | partly: points and engaged time shown; per-count display not verified | `modules/answer-stats.js` ENGAGEMENT_KIND |
| Provider score cache for "Most used" sort | derived from rounds | same | yes (sort) | `modules/provider-ranking.js` |
| AI summary API base URL, model | `chrome.storage.sync` settings | until changed | yes | `modules/settings.js` aiSummaryBaseUrl/Model |
| AI summary API key | `chrome.storage.local` `aiSummaryApiKey` | until cleared | Options field | `modules/ai-summary.js`; `options/options.js` L1149, L1180; never synced or exported (CL 2.25.0) |
| Answer texts for summary | memory only, not stored, not in stats | session | used by AI summary | CL 2.25.0; `multi-panel/multi-panel.js` `answerTextsByRound` |
| Rating prompt counters (successful Send All count, dismiss state) | `chrome.storage.local` `ratingPrompt` | until dismissed | banner only | `modules/rating-prompt.js` |
| Startup snapshot of panels | `panelize.startupSnapshot` | until changed | used at load | `modules/startup-snapshot.js` |
| Share snapshot mode (light/dark) | `chrome.storage.local` `shareSnapshotMode` | until changed | used | `multi-panel/multi-panel.js` L2961 |
| Popup window bounds | `popupWindowBounds` | until changed | used | `modules/open-multi-panel.js` |
| Panel column weights | `panelColumnWeights` | per layout | used | `modules/panel-resize.js` |
| Prompt-mode seeding flags | `promptModesSeeded`, `promptModesSeededIds`, `promptModeTriggersSeeded`, `samplePromptsCleanedV2` | forever | internal | `modules/prompt-modes.js` |
| Mimo session cookie mirror ownership | `mimoSessionCookieMirrors` | until changed | internal | `modules/mimo-session-cookies.js` |
| Pending multi-panel action | `pendingMultiPanelAction` | transient | internal | `background/service-worker.js` L36 |

Collected but not used or shown in UI (or not verified as shown): engagement click/scroll counts per answer (only summed into points); round category (WIP, now used); "Most used" stats in provider order (used). Not collected at all: the reasoning tier, prompt mode and trigger word per round; cost/tokens; answer quality ratings beyond adopt/reject; question text (only 100-char summary).

---

## 4. Constraints

### Platform
- MV3 service worker `background/service-worker.js` (`type: module`). Permissions: `storage, cookies, notifications, contextMenus, activeTab, scripting, declarativeNetRequest, declarativeNetRequestWithHostAccess, browsingData` (`manifest.json`).
- Host permissions: ChatGPT, Gemini, Grok, DeepSeek, Kimi, Doubao, Google, GitHub APIs (`manifest.json`). Claude and other providers reach their sites through `optional_host_permissions` and content_scripts. Optional host permissions include `https://*/*` (for user-configured AI summary API), localhost, and each optional provider's domains.
- Content scripts per provider in `manifest.json` `content_scripts`; each provider has its own injection and enter/text-injection scripts. Frames embedded with DNR header rules (`rules/bypass-headers.json`).
- No backend. No telemetry (README "Privacy First"; PRIVACY.md). The only network call outside provider sites is the optional AI summary API and GitHub update check.

### Provider DOM fragility
- Selectors break on provider site updates; many CL entries are selector fixes (CL 1.2.9, 1.3.1, 1.3.0, 2.12.1, 2.16.0, 2.35.0, 0280714 Agnes Lexical). Live smoke suite `tests/live/` and `playwright.live.config.js` exist, manual, not in CI (README "Live smoke tests").
- Unverified: Perplexity and Copilot embedded sending (CL 2.35.0; Cloudflare and Microsoft sign-in). Copilot sign-in refuses panel framing, so it opens in a new tab (CL 2.38.1). Perplexity service worker had to be removed before its panel loads, which required the `browsingData` permission (CL 2.38.2).
- Chrome keeps an old unpacked extension service worker until reload; panels then lack newer providers (commit f58ef24 body).

### Store and branding
- Chrome Web Store rejects listings that use AI provider or competitor names in title/summary; a test enforces this for every locale (commit c24e11b body).
- Shared snapshots include a "Compared with Panelize" watermark option (CL 2.0.0).

### Privacy and data boundaries
- `PRIVACY.md` (last updated 2026-10-24) says no API keys, no third-party transmission, no AI conversation content collected. This conflicts with the optional AI summary feature (CL 2.25.0): answer text is sent to a user-configured API. See Gaps.
- Blind mode hides provider names and answer stats (commit e9436cd body; CL 2.17.x); AI summary API sees anonymous labels (CL 2.25.0).
- Answer texts are not written to storage (CL 2.25.0).

### Localization
- UI is zh_CN and en only (CL 2.37.0). `README.ja.md` still exists (`git ls-files`), so the Japanese README is likely stale (note only; not verified against content).

### Quotas and limits
- Attachments: 10 files, 20 MB each (CL 2.18.0). AI summary: 20,000 chars per answer, 60,000 total, 5-min cap, 90-s idle timeout (`modules/ai-summary.js`; CL 2.42.0). Snapshot "Full answers" capped at 8000 px (eb2c35c body). Answer stats cap 1000 rounds (`modules/answer-stats.js`). Store listing string length limits (commit c24e11b).

### Repo rules (`AGENTS.md`)
- `master` is the development branch; `main` tracks fork upstream and is merged into `master` periodically (AGENTS.md, branch convention).
- Every code change bumps `x.y.z` in `manifest.json`, `package.json`, and the top two `version` fields in `package-lock.json`; fix = z, feature = y, breaking = x. Add a `CHANGELOG.md` top entry dated YYYY-MM-DD.
- `$review-branch-code` only on explicit request; active Goal tasks need a scoped review before completion (AGENTS.md).

### Testing and CI
- Vitest + happy-dom unit tests (~99 entries in `tests/`); Playwright e2e against fixtures (`tests/e2e/`); CI runs unit and e2e under xvfb (`.github/workflows/ci.yml` L33–52). Release workflows `release-prep.yml`, `release-publish.yml`, with gating scripts in `scripts/`.

---

## 5. Explicitly discussed, deferred, removed or rejected

### Removed or retired
- Claude model override workaround removed (CL 1.2.7; commit 08d842a). Experimental Claude model selection added (b738acd), then restricted (85e77ed).
- Eight non-zh/en language packs and their prompt-library guides removed (CL 2.37.0).
- Default "Import default library" of 70 sample prompts retired; samples now removed once, editing preserves (CL 2.28.0, 2.33.0).
- Bottom "New conversation" button hidden; use toolbar New Chat (CL 2.12.0).
- "Competitive" mode renamed Challenge (CL 2.22.0).
- Trigger word matching for paths/URLs intentionally excluded (CL 2.26.0).
- Unconfirmed timeouts do not cost points (CL 2.14.0 design rule).

### Not supported (explicit)
- Grok tier switching: unsupported; Google: Search/AI Mode not mapped to reasoning tiers (`docs/provider-modes.md`; commit e9436cd body "Grok marked unsupported").
- File attachments for Perplexity, Copilot, Wenxin, and all others except six providers (CL 2.18.0).
- Image attachments for Perplexity, Copilot, Wenxin (CL 2.35.0).
- Finish notification for Claude, StepFun, Agnes, Hy AI Studio (CL 2.19.0): they never trigger.
- Answer timing for Claude, StepFun, Agnes, Hy AI Studio (CL 2.16.0 explanation).
- Copilot panel sign-in inside panel (CL 2.38.1).
- Tier mapping: "Enter the model... exactly as the site shows"; the tier does not auto-send (`docs/provider-modes.md`).

### Pending or unresolved
- Perplexity/Copilot embedded sending: "remains unverified" (CL 2.35.0).
- MiMo API docs are not evidence of web control support (`docs/provider-modes.md`).
- Claude's model fallback is marked only after actual selection and verification (`docs/provider-modes.md`).
- `docs/provider-modes.md` (2026-10-29) is the design source for tier recipes; the doc says recipes are user-editable and "Restore defaults" exists (`options/options.html` `btnResetTierRecipes`).

### TODO/FIXME scan (`grep -rn TODO|FIXME|XXX|HACK`)
- Only in vendored `libs/Readability.js` (L2109, L2151, L2469). No project TODOs.

### Ideas parked in code comments or tests
- `tests/layout-auto-adjust.e2e.test.js` line 7 mentions a "rejected 31st panel" (capacity ceiling 30).

---

## 6. Constraints the brainstorm writer should know
- Any feature needing an account, server, or cloud sync conflicts with the PRIVACY.md and README promises. Settings already use `chrome.storage.sync`.
- Store listing rules forbid provider or competitor names in title/summary.
- Provider DOM changes are the main recurring maintenance cost (majority of release notes).
- Versioning rules add a CL entry and four version bumps per change.
- Blind mode constrains any feature that shows provider identity, including stats, notes, notifications, and summary chips.

---

## 7. User feedback and history signals

- No issue tracker or feedback docs in the repo. `.github/` has only CI/release workflows. `docs/` has only `provider-modes.md`. No `TODO.md`, `ROADMAP`, or user-feedback file.
- Upstream issues referenced in CHANGELOG 1.x: #30, #31, #35, #36, #37, #38, #39 (CL 1.0.3–1.1.0). Upstream PRs in git log: #54 to #94 (e.g., #87 Qwen auth, #88 Grok cookies, #91 snapshots, #93 store name).
- Store rating banner is the only in-product feedback channel (CL 2.0.0; `modules/rating-prompt.js`).
- Repeated pain points visible in CL history (likely user-reported): focus stolen from the composer by provider pages (CL 1.3.0, 2.18.1, 2.21.0); blind-mode flicker (CL 2.17.1); Enter sending from one panel only (CL 1.3.1); mouse back/forward navigating panels (CL 2.1.0); trackpad swipe navigation (CL 2.6.1); Grok and Qwen sign-in (CL 1.3.3); answer-stats timing misses for ChatGPT and others (CL 2.12.1, 2.16.0); Copilot and Perplexity blank panels (CL 2.38.1, 2.38.2).
- Doc-level feedback signals: README FAQ asks "How is Panelize different from ChatHub or ChatALL?". README says "Free · No API keys", which the AI summary feature contradicts.
- Maintainer is named as Ben (package.json author) and Manho/Xiaolai as upstream (PRIVACY.md contact).

---

## 8. Gaps, inconsistencies and things to check
- `README.md` and `PRIVACY.md` (updated 2026-10-24) predate AI summary (CL 2.25.0), notifications permission (CL 2.19.0), and the browsingData-only Perplexity fix. PRIVACY.md's permission table omits `notifications`, `activeTab`, `scripting`. README says "nothing leaves your machine" and "No API keys"; both conflict with the optional AI summary API.
- `CHANGELOG.md` has two `## 2.28.0 - 2026-10-28` headings (both at HEAD and WIP). No 2.44.0 entry.
- `README.ja.md` may be stale after the zh/en-only change (CL 2.37.0).
- Locale key counts differ (en 559, zh_CN 552 in working tree). Parity test not checked.
- `data/version-info.json` says `2.0.1` (commit c24e11b) while manifest is 2.47.0, so it is stale or release-generated; unverified which.
- Answer stats table: per-count engagement display not verified.
- `.claude/worktrees/mystifying-archimedes-ae366c` (branch `claude/mystifying-archimedes-ae366c`, commit `ee9e9b3`) and `.delta/clones/` were not inspected. They may hold unmerged ideas.
- AI summary persistence (whether summaries survive reload) not verified.
- Prompt library storage location not verified (`modules/prompt-manager.js` has no direct `chrome.storage` call found by grep).
- Tests not run.
