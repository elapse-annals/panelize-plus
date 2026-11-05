# Panelize Plus（百家）

<p align="center">
  <a href="README.md"><strong>English</strong></a> |
  <a href="README.zh-CN.md"><strong>简体中文</strong></a> |
  <a href="README.ja.md"><strong>日本語</strong></a>
</p>

> **Panelize Plus（百家）** is a personal, MIT-licensed fork of [Panelize](https://github.com/Manho/Panelize) by [Manho](https://github.com/Manho), maintained by Ben at [elapse-annals/panelize-plus](https://github.com/elapse-annals/panelize-plus). It keeps the original idea — one prompt to every AI, each provider's real website, the account you already use — and builds on it with AI summary, answer stats, prompt modes, a macOS menu-bar client and more. Upstream Panelize remains the original project; see [Upstream Panelize](#upstream-panelize).

<p align="center">
  <img src="assets/screenshots/promo-en.gif" alt="Panelize Plus demo: ask ChatGPT, Claude, Gemini and DeepSeek at once and compare answers side by side" width="800">
</p>

<p align="center">
  <strong>Stop switching tabs. Start comparing AI responses side by side.</strong>
</p>

<p align="center">
  <a href="https://github.com/elapse-annals/panelize-plus/releases/latest"><img src="https://img.shields.io/github/v/release/elapse-annals/panelize-plus?label=release" alt="Panelize Plus release"></a>
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License">
  <img src="https://img.shields.io/badge/Chrome%20%2F%20Edge-unpacked-4285F4.svg" alt="Chrome / Edge">
  <a href="https://github.com/Manho/Panelize/stargazers"><img src="https://img.shields.io/github/stars/Manho/Panelize?style=flat" alt="Upstream Panelize GitHub stars"></a>
</p>

<p align="center">
  <a href="#installation"><img src="https://img.shields.io/badge/Load%20Panelize%20Plus-from%20source-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Load Panelize Plus from source"></a>
</p>

<p align="center">
  <sub>Free · No API keys · Works with your existing AI logins</sub><br>
  <sub>Panelize Plus is a fork of <a href="https://github.com/Manho/Panelize">Panelize</a>; stars for the original project are welcome upstream.</sub>
</p>

---

## Why Panelize Plus?

Panelize Plus（百家）is a free, open-source Chrome and Edge extension that sends one prompt to ChatGPT, Claude, Gemini, Grok, DeepSeek and other AI chatbots at the same time and shows their answers side by side in one window. It loads each provider's real website with your existing login, so there are no API keys and no extra subscription.

Ever found yourself copying the same prompt across multiple AI tabs just to compare answers? Panelize Plus eliminates that workflow entirely.

**One window. One prompt. Multiple AI responses—instantly.**

<p align="center">
  <img src="assets/screenshots/main-panel.png" alt="Panelize Plus Main Interface" width="800">
</p>

---

## What Panelize Plus Changes

Panelize Plus starts from upstream Panelize **v2.0.1** (2026-10-23) and continues on its own history (`2.1.0` → `2.75.1`). Compared with upstream, this fork adds:

| Area | What's different |
| --- | --- |
| **AI summary** | Merges the round's answers into a verdict, agreements, unique insights and side-by-side disagreements, with source chips that jump to the quoted passage. Streams its reply, caches by question for three days, and can run automatically once 80% of the answers are done, through any OpenAI-compatible endpoint. |
| **Answer stats & blind mode** | Times each answer to first text and to completion, tracks which answers you adopt, scores providers, filters by task category, names the best model per category, weights the last 30 days, and crowns the three fastest answers. Blind mode hides AI names, evens out page styling and shuffles panel order. |
| **Prompt modes** | Modes are Prompt Library entries with trigger words; **Auto** applies them per send, with a ghost preview and `Tab` completion. Adds Deep thinking and an adversarial Challenge mode. Prompts can carry separate Chinese (shown) and English (sent) text. |
| **Composer & panels** | Image and document attachments, a readiness gate before sending, recent-question suggestions, per-AI status chips, click-to-locate, panel capacity and layout auto-adjust, popup position/size memory, wide mode and swipe feedback. |
| **Panelize Link (macOS)** | Optional menu-bar client with a global shortcut (`Option + Space` by default), a floating composer, prompt-mode picker, `Tab` completion and recent questions; it sends through the existing Send All flow over an opt-in Native Messaging bridge. |
| **Providers** | Adds StepFun, Agnes, Perplexity, Copilot and Wenxin (the last three optional), plus provider billing markers (including rate-limited) and many site-control fixes. |
| **Brand & language** | Renamed to **Panelize Plus（百家）**, with a new package name and About credits. The interface is reduced to Simplified Chinese and English, with Chinese as the default; the other eight language packs were removed. |
| **Defaults** | Fresh installs start from the maintainer's exported configuration — enabled providers and order, startup panels, Deep thinking as the default prompt mode, and a preconfigured AI summary endpoint (the API key stays on your device). |

The full change list is in [CHANGELOG.md](CHANGELOG.md). Upstream features and fixes that arrive later are merged into `master` through the `upstream` remote; see [Upstream Panelize](#upstream-panelize).

---

## Features at a Glance

### 🎯 Ask Once, Compare All

Type your question once and send it to ChatGPT, Claude, Gemini, Grok, Doubao, DeepSeek, Kimi, Qwen, Zhipu (China), Z.ai (Global), Yuanbao, MiMo, Meta AI, StepFun, Agnes, Hy AI Studio, Perplexity, Copilot, ERNIE (Wenxin), and Google simultaneously. See which AI gives you the best answer—no tab switching required. The composer also accepts images and documents (PDF, Office, text and code files) and sends them to providers that support them.

### 🌍 Panelize Link (macOS)

**Panelize Link** is an optional macOS menu-bar client. Open a floating composer from any app with `Option + Space` (default; `Control + Space` or `Command + Shift + Space` can be chosen instead); press Enter and the prompt goes through the same Send All flow to every AI in your current Panelize Plus window. The composer offers the built-in prompt modes (defaulting to Auto), previews what the selected mode will append, completes trigger words such as `/study` with `Tab`, and suggests the last three sent questions as you type. See [Panelize Link setup](desktop/macos/README.md).

### 📐 Flexible Layouts

Choose from 49 different layouts to fit your workflow, with capacity for up to 30 panels. Use 1×2 for a quick comparison, or 1×30 and 2×15 for larger sets. The number of panels you can open depends on the enabled providers. Focus a single panel to fill the window, switch to a popup window that reopens at its remembered size and position, or turn on wide mode to give each panel 1.5× the width with horizontal scrolling.

<p align="center">
  <img src="assets/screenshots/select-layout.png" alt="Layout Selection" width="600">
</p>

### ⚡ Zero Setup

No API keys. Log into your AI accounts normally, and Panelize Plus uses those sessions.

### 📚 Prompt Library

Save your best prompts and reuse them across all providers. Supports variables like `{topic}` for quick customization.

### 🎛️ Prompt Modes

Pick a mode in the composer to append a short instruction to what the AIs receive. **Auto** is the default: typing a trigger word such as `/study` (Learning), `/brief` (Concise), `/challenge` (Challenge), `/brainstorm` (Brainstorm) or `/think` (Deep thinking) applies that mode to this send only, with a ghost preview and `Tab` completion. Modes are ordinary Prompt Library entries, so you can edit their text, change their trigger words, delete them or add your own. **Default** adds nothing.

### 🧠 AI Summary

Merge the answers to the current question into one overview: a verdict, the points the AIs agree on, unique insights, and disagreements shown side by side. Every point names its sources, and clicking a source chip jumps to the quoted passage in that panel. It runs on demand or automatically once 80% of the answers are done, and needs an OpenAI-compatible endpoint (base URL, model, API key) configured in Settings; the AI panels themselves still need no API key.

### 📊 Answer Stats and Blind Mode

**Answer stats** times each answer from send to first text and to completion, tracks which answers you adopt, scores providers, filters by task category and names the best model per category; the three fastest answers wear gold, silver and bronze crowns on their top-bar chips. **Blind mode** hides AI names, evens out page styling and shuffles panel order, so you can judge answers without brand bias.

### 🖼️ Share a Snapshot

Turn the comparison into a shareable image—the current view or every panel—and copy or download it. The snapshot is captured and composed locally and stays on your device.

### 🔁 Recent Questions and Summary Cache

The composer suggests your last three sent questions above the input as you type a matching prefix; pick one to fill it in without sending. An AI summary of the same question is reused for up to three days, and **Summarize again** always refreshes it.

### 🔒 Privacy First

- One-click temporary chat (privacy mode) across supported providers
- Settings, history and snapshots stay in your browser—only what you send goes to the AI sites you use
- No tracking, no analytics, no data collection
- Open source—review the code yourself

---

## Supported AI Providers

<table align="center">
  <tr>
    <td align="center"><strong>ChatGPT</strong></td>
    <td align="center"><strong>Claude</strong></td>
    <td align="center"><strong>Gemini</strong></td>
    <td align="center"><strong>Grok</strong></td>
  </tr>
  <tr>
    <td align="center"><strong>Doubao</strong></td>
    <td align="center"><strong>DeepSeek</strong></td>
    <td align="center"><strong>Kimi</strong></td>
    <td align="center"><strong>Google</strong></td>
  </tr>
  <tr>
    <td align="center"><strong>Qwen (China)</strong></td>
    <td align="center"><strong>Qwen (Global)</strong></td>
    <td align="center"><strong>Zhipu (China)</strong></td>
    <td align="center"><strong>Z.ai (Global)</strong></td>
  </tr>
  <tr>
    <td align="center"><strong>Yuanbao</strong></td>
    <td align="center"><strong>MiMo</strong></td>
    <td align="center"><strong>Meta AI</strong></td>
    <td align="center"><strong>StepFun</strong></td>
  </tr>
  <tr>
    <td align="center"><strong>Agnes</strong></td>
    <td align="center"><strong>Hy AI Studio</strong></td>
    <td align="center"><strong>Perplexity</strong></td>
    <td align="center"><strong>Copilot</strong></td>
  </tr>
  <tr>
    <td align="center"><strong>ERNIE (Wenxin)</strong></td>
    <td></td>
    <td></td>
    <td></td>
  </tr>
</table>

Perplexity, Copilot, and ERNIE (Wenxin) are optional providers. Enable them in Settings and approve the requested site access. Their signed-in editors and send controls were inspected on the live pages, but embedded sending for Perplexity and Copilot remains unverified because of Cloudflare and Microsoft sign-in requirements. Wenxin embedding, text fill, Send All and Enter sending were verified on 2026-10-28. Image attachments are not enabled for these three providers.

<p align="center">
  <img src="assets/screenshots/settings.png" alt="Settings & Providers" width="700">
</p>

---

## Installation

Panelize Plus is not published to the Chrome Web Store; load it from this repository. (The original Panelize is on the store — see [Upstream Panelize](#upstream-panelize).)

### Load from source (Recommended)

1. Clone or download this repository
2. Go to `chrome://extensions/` (or `edge://extensions/`)
3. Enable **Developer mode**
4. Click **Load unpacked** and select the project folder
5. Press `Cmd/Ctrl + Shift + E` to open Panelize Plus

> **Works on Edge too:** Edge can load the same unpacked folder.

<details>
<summary><strong>Upstream Panelize from the Chrome Web Store</strong></summary>

The original [Panelize](https://github.com/Manho/Panelize) by Manho is published on the [Chrome Web Store](https://chromewebstore.google.com/detail/panelize/iokalaafkmjffolodkkgbbccmofbglii). Installing it gives you upstream features, not the Panelize Plus changes listed above.

</details>

### Panelize Link (Optional, macOS)

Requires macOS 13+, Chrome or Edge running, and Panelize Plus 2.66.0+. It is off by default: after installing the client, enable Settings → Global Input (macOS). It reuses the existing Send All flow rather than adding a separate AI pipeline. See [Panelize Link setup](desktop/macos/README.md) for installation, usage, and troubleshooting.

---

## Quick Start

1. **Log into your AI accounts** — Visit ChatGPT, Claude, etc. and log in as usual
2. **Press `Cmd/Ctrl + Shift + E`** — Opens the Panelize Plus window
3. **Pick a layout** — Choose how many AI panels you want
4. **Type and send** — Your prompt goes to all panels at once

That's it. No accounts to create, no API keys to configure.

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Open Panelize Plus | `Cmd/Ctrl + Shift + E` |
| Open Prompt Library | `Cmd/Ctrl + Shift + L` |
| Send to all AIs | `Enter` or `Cmd/Ctrl + Enter` |
| New line | `Shift + Enter` |
| Fill inputs without sending | `Cmd/Ctrl + Shift + Enter` |
| New conversation in all panels | `Cmd/Ctrl + Alt + N` |
| Focus the composer | `Cmd/Ctrl + Alt + K` |
| Fast / Balanced / Deep tier | `Cmd/Ctrl + Alt + 1 / 2 / 3` |
| Toggle wide mode | `Cmd/Ctrl + Alt + W` |
| Toggle blind mode | `Cmd/Ctrl + Alt + X` |
| Answer stats / Answer log | `Cmd/Ctrl + Alt + S` / `Cmd/Ctrl + Alt + R` |
| Share a snapshot | `Cmd/Ctrl + Alt + P` |
| Jump to panel 1–9 | `Ctrl + Shift + 1 – 9` |

The keyboard button in the bottom bar shows the actual bindings and lets you change or clear the in-page shortcuts; it also works inside AI panels. Browser-level shortcuts can be customized at `chrome://extensions/shortcuts`. On macOS, `Alt` is `Option`.

The bottom bar can switch between manual and popularity-first ordering; popularity-first ranks AIs by this device's answer-stats score and otherwise keeps the manual order. Tier buttons switch all open AIs at once, while Default keeps each site's own setting. Use the settings button beside the tiers to see the actual modes and per-panel results, and retry any panel that failed. See the [provider tier table](PROVIDER_MODES.md) for each provider's modes, defaults and account limits.

---

## FAQ

**How do I ask ChatGPT, Claude and Gemini the same question at once?**
→ Install Panelize Plus, open it with `Cmd/Ctrl + Shift + E`, pick the providers and a layout, type your prompt and click **Send All**. Each answer appears in its own panel.

**Is Panelize Plus free? Do I need API keys?**
→ Yes, it is free and MIT-licensed. No API keys are needed: each panel is the provider's own website, signed in with your normal account. Paid plans such as ChatGPT Plus or Claude Pro work as usual.

**How is Panelize Plus different from Panelize?**
→ Panelize Plus is a fork of Panelize by Manho. It keeps the side-by-side website panels and adds AI summary, deeper answer stats, prompt modes, the macOS Panelize Link client and more. See [What Panelize Plus Changes](#what-panelize-plus-changes). Upstream Panelize continues as the original project.

**How is Panelize Plus different from ChatHub or ChatALL?**
→ ChatHub and ChatALL put many models behind one chat interface. Panelize Plus shows each provider's real website instead, so you keep your own plans, model pickers and chat history.

**Which AI chatbots are supported?**
→ ChatGPT, Claude, Gemini, Grok, DeepSeek, Kimi, Qwen, Doubao, Zhipu, Z.ai, Yuanbao, MiMo, Meta AI, StepFun, Agnes, Hy AI Studio, Perplexity, Copilot, ERNIE (Wenxin) and Google AI Mode. See [Supported AI Providers](#supported-ai-providers).

## Troubleshooting

**AI provider shows login page?**
→ Log into that provider in a regular browser tab first, then refresh Panelize Plus.

**Shortcuts not working?**
→ Check for conflicts at `chrome://extensions/shortcuts`

**Qwen (Global) looks logged out after signing in?**
→ In Settings, enable Qwen (Global) and approve access to both `chat.qwen.ai` and `auth.qwen.ai`, then reload the panel. Existing users may need to approve the added authentication origin after updating Panelize Plus. If Qwen has already invalidated the session, sign in again on its website first.

**Need more help?**
→ [Open an issue](https://github.com/elapse-annals/panelize-plus/issues)

---

## Development and Testing

See [Architecture and source layout (Chinese)](ARCHITECTURE.md) for entry points, module boundaries, content-script loading and the macOS bridge.

```bash
npm install
npx playwright install chromium   # browser used by the e2e and live suites
```

With Playwright 1.58, `npx playwright install` can hang while it extracts the download under Node 26. The install then stays incomplete. If that happens, stop it and run the install once with Node 24 (for example `nvm exec 24 npx playwright install chromium`). The e2e suite then uses the installed browser under any Node version.

| Command | What it runs |
| --- | --- |
| `npm test` | Unit and integration tests (Vitest + happy-dom) |
| `npm run test:e2e` | Extension e2e tests: the real extension against local fixture sites, headless and in parallel |
| `npm run test:e2e:headed` | Same, with visible windows for debugging (or set `PANELIZE_E2E_HEADED=1`) |
| `npm run test:live:login` | Opens the live-test profile in a normal browser window so you can log in to providers |
| `npm run test:live` | Smoke checks against the real provider sites (manual, not part of CI) |

### Live smoke tests

The live suite catches provider site changes that fixtures cannot. For each provider it opens the real multi-panel page, types into the unified input, and presses **Fill**. It then checks that the text reached the provider's composer and that the send and new-chat selectors still match. Without `PANELIZE_LIVE_SEND` it then clears the composer and reloads the panel to confirm that no test text stays behind as a saved draft. A provider whose composer already holds a draft of yours is skipped, so the test never touches your text.

1. Run `npm run test:live:login` and log in to each provider. If a panel still looks logged out, log in inside that panel on the multi-panel tab, because panel iframes use partitioned storage. Quit the browser when you are done (Cmd+Q on macOS); with more than 12 providers the next batch then opens. The logins are kept in the profile, so this is a one-time step.
2. Run `npm run test:live`, ideally before every release. By default it opens a visible window, because several sites block headless browsers.
3. Failures save a screenshot and the provider frame's HTML under `test-results/live/`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PANELIZE_LIVE_PROFILE` | `~/.panelize-live-profile` | Profile directory that keeps the logins |
| `PANELIZE_LIVE_PROVIDERS` | all providers | Comma-separated ids, e.g. `chatgpt,doubao` |
| `PANELIZE_LIVE_SEND` | off | `1` actually sends the prompt, which uses provider quota |
| `PANELIZE_LIVE_HEADLESS` | off | `1` runs headless; expect Cloudflare challenges on some sites |

---

## Contributing

Found a bug? Have an idea? Contributions are welcome:
- 🐛 Report bugs or ask about Panelize Plus changes via [GitHub Issues](https://github.com/elapse-annals/panelize-plus/issues)
- 💡 Suggest features
- 🔧 Submit pull requests to this repository

Fixes that also apply to the original project belong in [Manho/Panelize](https://github.com/Manho/Panelize/issues) instead.

---

## Upstream Panelize

Panelize Plus is a derivative work of [Panelize](https://github.com/Manho/Panelize) by Manho, used under the MIT License. Upstream Panelize is the original project and the place for its community, Chrome Web Store release and documentation at [panelize.dev](https://panelize.dev).

The fork and its attribution are recorded in [NOTICE.md](NOTICE.md). This repository keeps an `upstream` git remote and merges upstream changes into `master`:

```bash
git fetch upstream
git merge upstream/master
```

Panelize Plus-specific changes are kept on their own commit history so they can be separated from upstream.

---

## License

MIT License — see [LICENSE](LICENSE) for details. Panelize Plus is derived from Panelize by Manho; see [NOTICE.md](NOTICE.md).

---

<p align="center">
  <strong>Open source & privacy-focused</strong><br>
  Interface available in English and Simplified Chinese · READMEs in English, Chinese and Japanese
</p>

<p align="center">
  <sub>Made for everyone who's tired of tab-switching between AI assistants.</sub>
</p>
