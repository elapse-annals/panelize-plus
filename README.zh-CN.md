# Panelize Plus（百家）

<p align="center">
  <a href="README.md"><strong>English</strong></a> |
  <a href="README.zh-CN.md"><strong>简体中文</strong></a>
</p>

> **Panelize Plus（百家）** 是 [Manho](https://github.com/Manho) 的 [Panelize](https://github.com/Manho/Panelize) 的个人衍生版本（MIT 许可证），由 Ben 在 [elapse-annals/panelize-plus](https://github.com/elapse-annals/panelize-plus) 维护。它保留原项目的核心思路 —— 一次提问发给所有 AI，每个面板加载官方网站，直接使用你已登录的账号 —— 并在此基础上增加了 AI 总结、回答统计、提示词模式、macOS 菜单栏客户端等能力。上游 Panelize 仍是原始项目，见 [上游 Panelize](#上游-panelize)。

<p align="center">
  <img src="assets/screenshots/promo-zh.gif" alt="Panelize Plus 演示：一次提问，并排对比 ChatGPT、Claude、Gemini、DeepSeek 的回答" width="800">
</p>

<p align="center">
  <strong>告别反复切换标签页，一次提问并排对比多个 AI 回答。</strong>
</p>

<p align="center">
  <a href="https://github.com/elapse-annals/panelize-plus/releases/latest"><img src="https://img.shields.io/github/v/release/elapse-annals/panelize-plus?label=release" alt="Panelize Plus 版本"></a>
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License">
  <img src="https://img.shields.io/badge/Chrome%20%2F%20Edge-unpacked-4285F4.svg" alt="Chrome / Edge">
  <a href="https://github.com/Manho/Panelize/stargazers"><img src="https://img.shields.io/github/stars/Manho/Panelize?style=flat" alt="上游 Panelize GitHub stars"></a>
</p>

<p align="center">
  <a href="#安装"><img src="https://img.shields.io/badge/%E4%BB%8E%E6%BA%90%E7%A0%81%E5%8A%A0%E8%BD%BD%20Panelize%20Plus-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="从源码加载 Panelize Plus"></a>
</p>

<p align="center">
  <sub>免费 · 无需 API Key · 直接使用你已登录的 AI 账号</sub><br>
  <sub>Panelize Plus 是 <a href="https://github.com/Manho/Panelize">Panelize</a> 的衍生版本，欢迎给原项目点 ⭐。</sub>
</p>

---

## 为什么选择 Panelize Plus？

Panelize Plus（百家）是一个免费、开源的 Chrome / Edge 扩展：一次输入，同时发给 ChatGPT、Claude、Gemini、DeepSeek、Kimi、豆包等 AI，并在同一个窗口里并排显示它们的回答。每个面板加载的都是官方网站，直接使用你已登录的账号，不需要 API Key，也不用额外订阅。

还在把同一个 Prompt 复制到多个 AI 标签页里逐个比较吗？

**Panelize Plus 让你在一个窗口里，一次发送，直接横向对比多个 AI 的答案。**

<p align="center">
  <img src="assets/screenshots/main-panel.png" alt="Panelize Plus 主界面" width="800">
</p>

---

## Panelize Plus 做了哪些改造

Panelize Plus 从上游 Panelize **v2.0.1**（2026-10-23）继续，拥有独立的历史（`2.1.0` → `2.75.1`）。与上游相比，本分支新增：

| 方向 | 具体改造 |
| --- | --- |
| **AI 总结** | 把同一轮的所有回答合并为结论、共识、独到见解和并列展示的分歧，每个要点带来源芯片，可跳转到原回答的对应段落。支持流式输出、按问题缓存 3 天，可在 70% 回答完成时自动汇总；使用任意 OpenAI 兼容接口。 |
| **回答统计与盲测** | 记录每次回答出现首字和完成的耗时、采纳情况与平台评分，可按任务类别筛选并列出各类别最佳模型，按最近 30 天加权，最快的前三个回答显示金、银、铜冠。盲测模式隐藏 AI 名称、统一页面样式并打乱面板顺序。 |
| **提示词模式** | 模式就是 Prompt Library 中的条目，可设置触发词；**自动**模式按触发词在本次发送中应用，支持幽灵预览与 `Tab` 补全。新增深度思考和对抗式审阅的挑战模式。提示词可同时保存中文（界面显示）和英文（实际发送）两版。 |
| **输入与面板体验** | 图片 / 文档附件、发送前的就绪状态门控、最近提问建议、每个 AI 的状态芯片、点击芯片定位并高亮、面板容量与布局自适应、弹窗位置和尺寸记忆、宽屏模式与滑动边界提示。 |
| **Panelize Link（macOS）** | 可选的菜单栏客户端：全局快捷键（默认 `Option + Space`）唤起浮动输入框，支持提示词模式选择、`Tab` 触发词补全和最近提问，通过现有的 Send All 流程发送，Native Messaging 桥接默认关闭、可在设置中开启。 |
| **平台** | 新增 StepFun、Agnes、Perplexity、Copilot 和文心（后三个为可选平台），增加平台计费标记（含限流），并修复多项站点控件与新对话适配。 |
| **品牌与语言** | 改名为 **Panelize Plus（百家）**，使用新的包名，并在“关于”中标注作者与上游来源。界面精简为简体中文与英文（默认中文），移除了其余 8 种语言包。 |
| **默认配置** | 新安装按维护者导出的配置初始化：启用的平台及顺序、启动面板、默认使用“深度思考”模式，以及预配置的 AI 总结接口（API Key 仍只保存在本机）。 |

完整改动见 [CHANGELOG.md](CHANGELOG.md)。上游后续的功能与修复会通过 `upstream` 远程合并进 `master`，详见 [上游 Panelize](#上游-panelize)。

---

## 核心功能

### 一次提问，同时对比

在统一输入框中输入一次内容，就能同时发送到 ChatGPT、Claude、Gemini、Grok、Doubao、DeepSeek、Kimi、Qwen、Zhipu (China)、Z.ai (Global)、元宝、MiMo、Meta AI、阶跃 StepFun、Agnes、腾讯混元 Hy AI Studio、Perplexity、Copilot、文心、Google。输入框也支持添加图片和文档（PDF、Office、文本和代码文件），并随问题发送给支持的平台。

### Panelize Link 系统级快捷发送（macOS）

可选安装 **Panelize Link** macOS 菜单栏客户端后，在任意应用里按 `Option + Space`（默认，也可改为 `Control + Space` 或 `Command + Shift + Space`）唤起浮动输入框；按 Enter 后，内容会通过现有 Send All 流程发送给当前 Panelize 窗口里的所有 AI。输入框提供内置提示词模式（默认“自动”），会预览所选模式将追加的说明，可用 `Tab` 补全 `/study` 等触发词，并在输入时提示最近 3 条提问。详见 [Panelize Link 安装说明](desktop/macos/README.zh-CN.md)。

### 灵活布局

支持 49 种布局，面板上限为 30 个。快速双模型对比可用 1×2，大规模对比可用 1×30 或 2×15；实际可打开的面板数量取决于已启用的平台数量。可聚焦单个面板铺满窗口，也可切换到会记住尺寸和位置的弹窗，或开启宽屏模式让每个面板加宽 1.5 倍并横向滚动。

<p align="center">
  <img src="assets/screenshots/select-layout.png" alt="布局选择" width="600">
</p>

### 零配置

不需要 API Key，也不需要额外账号。通常在浏览器里登录对应平台即可使用。

### Prompt Library

可保存常用提示词，并支持 `{topic}` 这类变量占位符，复用更高效。

### 提示词模式

在输入框选择模式，为发送给 AI 的内容追加一段简短说明。默认的**自动**模式会在问题中出现触发词时临时应用对应模式，例如 `/study`（学习）、`/brief`（简洁）、`/challenge`（挑战）、`/brainstorm`（头脑风暴）、`/think`（深度思考），并显示将要追加内容的幽灵预览，可用 `Tab` 补全触发词。模式本身就是 Prompt Library 中的普通提示词，可修改文本和触发词、删除或自行新增；**默认**模式不追加任何内容。

### AI 总结

把当前问题的所有回答合并成一份总览：结论、各 AI 的共识、独到见解，以及并列展示的分歧。每个要点都会标注来源，点击来源芯片可跳转到原回答中的对应段落。可手动生成，也可在 70% 的回答完成后自动生成；需要在设置中配置兼容 OpenAI 的接口（Base URL、模型、API Key），AI 面板本身仍然不需要 API Key。

### 回答统计与盲测模式

**回答统计**记录每次回答从发送到出现首字、到完成的时间，统计采纳情况并给出平台评分，可按任务类别筛选并列出各类别的最佳模型；最快的前三个回答会在顶栏芯片上显示金、银、铜冠。**盲测模式**隐藏 AI 名称、统一页面样式并打乱面板顺序，让你在没有品牌偏见的情况下判断回答质量。

### 分享对比快照

把当前视图或全部面板合成为一张图片，可复制或下载；快照在本地截取和合成，不会离开你的设备。

### 最近提问与总结缓存

输入内容与最近发送的问题开头匹配时，输入框上方会显示最近 3 条提问，选中即可填入而不直接发送。相同问题的 AI 总结会在 3 天内复用，点“重新汇总”可强制刷新。

### 隐私优先

- 一键为兼容平台开启临时对话（隐私模式）
- 设置、历史记录和快照保存在本地浏览器，只有你发送的内容会到达所用平台
- 无追踪、无埋点、无数据上传
- 完全开源，可自行审阅代码

---

## 支持的 AI 平台

- ChatGPT
- Claude
- Gemini
- Grok
- Doubao
- DeepSeek
- Kimi
- Qwen（中国版）
- Qwen（海外版）
- Zhipu (China)
- Z.ai (Global)
- 元宝
- MiMo
- Meta AI
- StepFun
- Agnes
- Hy AI Studio
- Perplexity
- Copilot
- 文心
- Google

Perplexity、Copilot 和文心是可选平台，需要在设置中启用并授予对应的网站访问权限。三个站点登录后的输入框和发送控件均已在真实网页中核实；受 Cloudflare 验证和 Microsoft 登录要求影响，Perplexity、Copilot 的内嵌发送仍未验证。文心已于 2026-10-28 通过真实网站的内嵌、填充、Send All 和 Enter 发送验证。三者暂不支持图片附件。

<p align="center">
  <img src="assets/screenshots/settings.png" alt="设置与平台管理" width="700">
</p>

---

## 安装

Panelize Plus 未发布到 Chrome Web Store，请从本仓库加载。（原版 Panelize 已在商店上架，见 [上游 Panelize](#上游-panelize)。）

### 从源码加载（推荐）

1. 克隆或下载本仓库
2. 打开 `chrome://extensions/`（或 `edge://extensions/`）
3. 开启“开发者模式”
4. 点击“加载已解压的扩展程序”，选择项目目录
5. 按 `Cmd/Ctrl + Shift + E` 打开 Panelize Plus

> **Edge 也可用：** 同样可以加载这个已解压的目录。

<details>
<summary><strong>从 Chrome Web Store 安装原版 Panelize</strong></summary>

Manho 的原始 [Panelize](https://github.com/Manho/Panelize) 已发布在 [Chrome Web Store](https://chromewebstore.google.com/detail/panelize/iokalaafkmjffolodkkgbbccmofbglii)。安装它获得的是上游功能，不包含上面列出的 Panelize Plus 改造。

</details>

### Panelize Link 全局快捷发送（可选，macOS）

需要 macOS 13+、Chrome 或 Edge 正在运行，以及 Panelize Plus 2.66.0+。该功能默认关闭：安装客户端后，在“设置 → 全局快捷输入（macOS）”中开启。它复用现有的 Send All 流程，不会另起一套 AI 调用。安装、使用和排错见 [Panelize Link 文档](desktop/macos/README.zh-CN.md)。

---

## 快速开始

1. **先登录各平台账号**：先在普通网页标签页登录 ChatGPT / Claude 等
2. **按 `Cmd/Ctrl + Shift + E`**：打开 Panelize Plus
3. **选择布局**：按需求选择面板数量与布局
4. **输入并发送**：一次发送到所有面板

---

## 快捷键

| 操作 | 快捷键 |
|------|--------|
| 打开 Panelize Plus | `Cmd/Ctrl + Shift + E` |
| 打开 Prompt Library | `Cmd/Ctrl + Shift + L` |
| 发送给全部 AI | `Enter` 或 `Cmd/Ctrl + Enter` |
| 换行 | `Shift + Enter` |
| 仅填充输入框 | `Cmd/Ctrl + Shift + Enter` |
| 批量新对话 | `Cmd/Ctrl + Alt + N` |
| 聚焦统一输入框 | `Cmd/Ctrl + Alt + K` |
| 快速／均衡／深度档位 | `Cmd/Ctrl + Alt + 1 / 2 / 3` |
| 切换宽屏模式 | `Cmd/Ctrl + Alt + W` |
| 切换盲测模式 | `Cmd/Ctrl + Alt + X` |
| 回答统计／回答记录 | `Cmd/Ctrl + Alt + S` / `Cmd/Ctrl + Alt + R` |
| 分享对比快照 | `Cmd/Ctrl + Alt + P` |
| 切换布局 | `Cmd/Ctrl + Alt + G` |
| 跳转到第 1–9 个面板 | `Ctrl + Shift + 1 – 9` |

底栏键盘按钮可修改页面快捷键，悬浮按钮可查看实际绑定；这些快捷键在 AI 面板输入框内也能使用。macOS 的 `Alt` 对应 `Option`。打开扩展和提示词库的浏览器级快捷键可在 `chrome://extensions/shortcuts` 自定义。

底栏可切换“手动／常用优先”排序；常用优先按本机回答统计分数排列 AI，保留原手动顺序。档位按钮会批量切换当前已打开的 AI，“默认”保留各平台自己的设置。点击档位旁的设置按钮查看实际模式与逐面板结果，未成功项可单独重试。各平台的模式、默认匹配与账号限制见 [AI 档位匹配表](PROVIDER_MODES.md)。

---

## 常见问题

**怎样同时问 ChatGPT、Claude 和 DeepSeek 同一个问题？**
→ 安装 Panelize Plus，按 `Cmd/Ctrl + Shift + E` 打开，选好 AI 和布局，输入问题后点 **Send All**，每个 AI 的回答会显示在各自的面板里。

**Panelize Plus 免费吗？需要 API Key 吗？**
→ 免费，MIT 开源。不需要 API Key：每个面板就是官方网站，用你平时登录的账号。ChatGPT Plus、Claude Pro 等付费套餐照常可用。

**Panelize Plus 和 Panelize 有什么区别？**
→ Panelize Plus 是 Manho 的 Panelize 的衍生版本，保留并排官网面板的核心体验，并增加了 AI 总结、更完整的回答统计、提示词模式、macOS 的 Panelize Link 客户端等能力。详见 [Panelize Plus 做了哪些改造](#panelize-plus-做了哪些改造)。上游 Panelize 仍是原始项目。

**和 ChatHub、ChatALL 有什么区别？**
→ ChatHub 和 ChatALL 是把多个模型接到同一个聊天界面里；Panelize Plus 直接显示各家官网，所以你的套餐、模型选择和聊天记录都保留在各自账号里。

**AI 页面显示登录状态？**
→ 先在普通标签页登录该平台，再刷新 Panelize Plus。

**快捷键无效？**
→ 到 `chrome://extensions/shortcuts` 检查冲突。

**需要帮助？**
→ [提交 Issue](https://github.com/elapse-annals/panelize-plus/issues)

---

## 贡献

开发前可先阅读[项目结构与开发导航](ARCHITECTURE.md)，了解入口、模块职责、脚本加载顺序及测试方式。

欢迎反馈与贡献：

- 🐛 提交 Bug（Panelize Plus 的改动请提到本仓库）
- 💡 提出功能建议
- 🔧 提交 Pull Request

同样适用于原项目的修复，请提交到 [Manho/Panelize](https://github.com/Manho/Panelize/issues)。

---

## 上游 Panelize

Panelize Plus 是 Manho 的 [Panelize](https://github.com/Manho/Panelize) 的衍生作品，按 MIT License 使用。上游 Panelize 是原始项目，也是其社区、Chrome Web Store 发布和 [panelize.dev](https://panelize.dev) 文档的所在地。

衍生关系与署名记录在 [NOTICE.md](NOTICE.md)。本仓库保留了 `upstream` git 远程，会把上游改动合并进 `master`：

```bash
git fetch upstream
git merge upstream/master
```

Panelize Plus 特有的改动保留在独立的提交历史中，便于与上游区分。

---

## License

MIT License，详见 [LICENSE](LICENSE)。Panelize Plus 衍生自 Manho 的 Panelize，见 [NOTICE.md](NOTICE.md)。
