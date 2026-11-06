# Panelize Link（macOS 全局快捷发送）

这是一个可选的 macOS 菜单栏客户端：在任意应用里按一次快捷键，输入问题后直接通过 Panelize 的 **Send All** 发送给当前所有 AI，不需要先切换到浏览器。

它复用扩展已有的发送流程和 AI 就绪门槛：已就绪的 AI 会收到消息，仍在加载的 AI 会被跳过，浮动窗会显示实际发送数量。客户端在本机保留最近 3 条已发送的问题用于输入建议；不搜索本地提示词或问答记录，也不保存回答。

## 要求

- macOS 13 或更高版本（Apple silicon / arm64）
- Chrome 或 Edge 正在运行，并已安装 Panelize 2.59.0 或更高版本（提示词模式选择器需要 Panelize 2.62.0 或更高版本，以及重新构建的原生宿主）
- Xcode Command Line Tools（仅从源码构建时需要）

## 安装

从 [Releases](https://github.com/elapse-annals/panelize-plus/releases) 下载并解压 `panelize-link-<version>-macos-arm64.zip`。压缩包包含应用、交互式安装器和这份说明；安装发布版不需要仓库源码、Node.js 或 Swift。

在解压目录中双击 `Install.command`，选择 Chrome 或 Edge，再粘贴该浏览器扩展管理页显示的扩展 ID。安装器也接受完整的 `chrome-extension://...` 设置页地址。它会把同目录的应用安装到 `~/Applications`，并为所选浏览器注册 Native Messaging host。若 macOS 阻止运行命令文件，可在终端进入解压目录后执行：

```bash
bash ./install.sh --browser chrome --extension-id 你的扩展ID
```

将扩展 ID 替换为 `chrome://extensions` 或 `edge://extensions` 中显示的值。`--browser` 可选择 `chrome` 或 `edge`。替换已有应用或 Native Messaging 清单前，安装器会保留带时间戳的备份。安装只修改当前用户配置，不需要 `sudo`。

发布版应用采用 ad-hoc 签名，未经公证：首次启动时请右键点击应用选择 **打开**，或在“系统设置 → 隐私与安全性”中允许。

也可以直接从源码构建，在仓库根目录执行不带 `--app` 的安装脚本：

```bash
./desktop/macos/Scripts/install.sh --browser chrome
```

从仓库 checkout 安装开发版时，脚本默认使用 Chrome 从该仓库路径解压加载时分配的扩展 ID。如果扩展从其他位置加载或来自 Chrome Web Store，请传入 `chrome://extensions` 显示的 ID。使用 `--app` 安装下载的应用时，也必须显式传入 `--extension-id`：

```bash
./desktop/macos/Scripts/install.sh --browser chrome --extension-id 你的扩展ID
```

脚本会：

1. 从源码构建应用，或将下载的同目录应用安装到 `~/Applications`；
2. 写入当前用户的 Native Messaging host 配置，只允许指定扩展 ID；
3. 打印后续步骤。安装不需要 `sudo`，也不会自动加入登录项。

安装后重新加载 Panelize 扩展（或重启浏览器），再打开一次应用：

```bash
open "$HOME/Applications/Panelize Link.app"
```

只把 `Panelize Link.app` 拖到“应用程序”文件夹不会注册浏览器桥接。请运行发布包中的安装器，让它用实际的扩展 ID 和应用安装路径创建 Native Messaging 清单。

在 Panelize 的设置中打开 **“全局快捷输入（macOS）”**，开启 **“启用全局输入桥接”**。该桥接默认关闭，开启前扩展不会启动应用，也不会维持原生心跳。开启后，浏览器重新连接时会按需在后台启动应用。可选：在“系统设置 > 通用 > 登录项”中把它加入登录启动。若从菜单栏主动退出应用，浏览器不会自动重新拉起它；下次需要手动打开一次。

## 使用

- `Option + Space`（默认）或菜单栏里的“打开快捷输入”唤出浮动窗。
- 浮窗出现在当前屏幕靠下的位置，带柔和阴影。点击浮窗外部或菜单栏图标即可关闭，`Esc` 也可关闭。
- 输入问题，按 `Enter` 发送给所有 AI。扩展确认多面板页面已打开或复用后，运行本地桥的浏览器会立即前置，浮窗继续显示进度：准备阶段显示“AI 准备中：3/5”，随后显示“正在发送…”。发送期间，输入框下方会列出仍在等待或未就绪的 AI 名称；长名单会省略，悬停与辅助技术仍可读取完整名单。盲测模式只显示数量。就绪数达到 `ceil(AI 总数 × 0.7)` 后开始发送。
- 发送期间及成功结果停留期间，应用失去前台不会自动关闭浮窗；点击浮窗外部、`Esc` 或快捷键仍可收起。进度更新不会重新打开已收起的浮窗，再次唤出时会恢复最新进度。发送结果返回后进度结束，模式预览恢复。
- 输入内容与最近发送的某条问题开头匹配时，输入框上方会以独立浮层显示最近 3 条提问（标题“最近提问”，比输入卡片更窄，紧贴卡片上缘并叠在卡片后面，避免被当成输入内容）。用 `↑` / `↓` 高亮，`Enter` 填入输入框但不发送，也可以直接点击；在最后一条上再按 `↓` 会取消高亮并回到输入框；`Esc` 先关闭列表，再按一次才关闭浮窗。
- 底部左侧的胶囊选择器可选择内置提示词模式，默认“自动”。菜单每项下方会显示该模式的说明，选择器下方常驻一行当前模式的说明。模式名、说明、触发词图例和预览文案跟随 macOS 系统语言：中文系统使用中文，其他语言使用英文。选择保存在本机，只影响当次发送，不会修改扩展里保存的模式。“自动”仅在问题包含 `/study` 等触发词时追加对应模式；“默认”不追加任何内容。升级到 2.64.0 时会把此前保存的模式一次性重置为“自动”，之后的选择仍会保留。输入框为空时按 `Tab` / `Shift + Tab` 可在模式间循环切换；光标处有触发词补全时，`Tab` 优先接受补全；已有内容时 `Tab` 不切换模式。
- 自动模式下，在行尾输入触发词前缀（如 `/st`）时，光标处会显示剩余部分（`udy`）和带底纹的 `Tab · 学习` 提示，按 `Tab` 补全并追加一个空格。补全遵循扩展的行尾与整词边界规则，只覆盖内置触发词；扩展里自定义的触发词不会同步到客户端。
- 输入框下方会用浅灰常规字预览当前模式将追加的内容：选择具体模式时显示内置指令，Auto 显示匹配的模式或触发词图例，“默认”不显示；底部用浅色行内提示 Enter / Shift + Enter / Tab（切换模式）/ Esc。连接正常时底部只显示绿色对勾图标；未连接、发送中或出错时才显示短文案。未连接时，点击这段状态（或菜单栏里的浏览器状态）会打开扩展设置并定位、高亮“启用全局输入桥接”开关；浏览器和扩展 ID 取自安装时写入的本地桥清单。
- 输入区会随内容从约 3 行增高到 5 行，超过后内部滚动；发送成功或清空后自动收回。发送过程中，发送按钮内显示小进度指示。
- `Command + A / C / V / X / Z` 分别全选、复制、粘贴、剪切、撤销，`Shift + Command + Z` 重做；菜单栏的“编辑”菜单提供相同命令。
- 浮窗会遵循 macOS 的“降低动态效果”“降低透明度”和“增强对比度”：降低透明度时使用不透明背景，增强对比度时加深边框与文字，状态同时用图标形状和颜色表达。
- `Shift + Enter` 换行；`Esc` 先关闭已展开的建议列表，否则关闭浮窗。
- 可在菜单栏图标中选择改用 `Command + Shift + Space`。
- 发送成功后会显示“已发送至 N 个 AI”，约 1 秒后自动关闭浮窗；浏览器已在扩展打开或复用面板时前置（连接旧扩展、没有进度事件时改为在结果返回后前置）。失败时保留输入内容并显示原因。

若 Panelize 页面尚未打开，扩展会先打开它，等待 AI 面板就绪后再发送。浏览器未运行、扩展未重新加载或本地桥未安装时，浮动窗会显示“浏览器未连接”，不会把未发送显示成成功。

## 安全与限制

- 桌面应用与扩展只通过本机 Unix socket 通信；socket 目录权限为 `0700`，socket 与一次性 token 为 `0600`。
- Native Messaging host 只接受安装时指定的扩展来源，不提供 shell、任意 URL 或文件访问接口。
- 应用只监听发往其他应用的鼠标按下事件，用于点击外部关闭浮窗；不记录点击或键盘输入，鼠标监听不需要辅助功能权限。
- 最近 3 条提问保存在本机 `UserDefaults`（`recentQuestions.v1`），不经过本地桥；清除应用偏好设置即可删除。
- 内置提示词模式的名称、说明、预览与触发词在构建与开发期由 `scripts/sync-desktop-prompts.js` 从扩展的 `_locales/zh_CN/messages.json`、`_locales/en/messages.json` 和 `modules/prompts/prompt-modes.js` 统一生成，保证单一真值；客户端启动时按 macOS 系统语言选择中文或英文。运行时原生应用不会收到提示词库内容。在扩展里编辑内置模式会改变实际发送内容，但不会同步到客户端本地预览。
- 浏览器必须保持运行；退出浏览器后无法发送。
- 本地构建使用 ad-hoc 签名，未做 Developer ID 签名与公证。自行从源码构建不会经过网络分发；若要公开分发，需要另行签名和公证。
- 应用显示期间会暂时作为普通 macOS 应用取得键盘焦点，关闭后恢复为仅菜单栏应用。

## 排错

**一直显示“浏览器未连接”**

1. 确认 Panelize 版本不低于 2.60.0，在扩展管理页重新加载，并在设置中开启“全局快捷输入（macOS）”。
2. 从解压目录重新运行 `Install.command` 或 `bash ./install.sh`，选择当前使用的浏览器并输入实际扩展 ID。解压加载的扩展在路径变化后可能会获得新 ID。
3. 检查所选浏览器的 `NativeMessagingHosts/com.panelize.global_sender.json` 是否存在，且其中的 `path` 指向 `~/Applications/Panelize Link.app/Contents/MacOS/PanelizeSearchBridge`。
4. 完全退出并重新打开浏览器，再打开一次应用。

**点击状态后显示“此页面已被 Chrome 屏蔽”（`ERR_BLOCKED_BY_CLIENT`）**

本地桥清单里的扩展 ID 并不是 Chrome 当前加载（或已启用）的扩展。请重新运行安装器，并传入 `chrome://extensions` 或 `edge://extensions` 中显示的扩展 ID。

**快捷键没有反应或提示被占用**

在菜单栏图标中选择另一个快捷键（`Control + Space` 或 `Command + Shift + Space`）。`Option + Space` 可能被其他输入法或快捷工具占用。

**构建失败**

先确认 `xcode-select -p` 指向有效的 Command Line Tools，再执行：

```bash
swift test --package-path desktop/macos
./desktop/macos/Scripts/build-app.sh
```

## 卸载

1. 从菜单栏退出应用。
2. 删除 `~/Applications/Panelize Link.app`。
3. 删除 Native Messaging 配置：
   `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.panelize.global_sender.json`
   （Edge 对应 `Microsoft Edge/NativeMessagingHosts`。）
4. 可选：删除 `~/Library/Application Support/Panelize Link/`（只包含本地桥的 socket 与 token）。

## 开发

```bash
swift test --package-path desktop/macos
./desktop/macos/Scripts/build-app.sh
```

构建产物在 `dist/Panelize Link.app`，不会进入扩展发布包。在 Apple silicon Mac 上打包，并补传到 Release Publish 创建的 Release：

```bash
RELEASE_VERSION=x.y.z ./scripts/release/package-macos-app.sh
gh release upload "vx.y.z" "dist/release-x.y.z/panelize-link-x.y.z-macos-arm64.zip"
```

扩展侧的协议测试在 `tests/unit/platform/global-send.test.js` 与 `tests/unit/background/native-send.test.js`。
