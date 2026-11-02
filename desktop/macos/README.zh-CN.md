# Panelize macOS 全局快捷发送

这是一个可选的 macOS 菜单栏客户端：在任意应用里按一次快捷键，输入问题后直接通过 Panelize 的 **Send All** 发送给当前所有 AI，不需要先切换到浏览器。

它复用扩展已有的发送流程和 AI 就绪门槛：已就绪的 AI 会收到消息，仍在加载的 AI 会被跳过，浮动窗会显示实际发送数量。客户端不搜索本地提示词或问答记录，也不保存问题与回答。

## 要求

- macOS 13 或更高版本
- Chrome 或 Edge 正在运行，并已安装 Panelize 2.59.0 或更高版本（提示词模式选择器需要 Panelize 2.62.0 或更高版本，以及重新构建的原生宿主）
- Xcode Command Line Tools（用于从源码构建）

## 安装

在仓库根目录执行：

```bash
./desktop/macos/Scripts/install.sh --browser chrome
```

从 Chrome Web Store 安装的 Panelize 使用默认扩展 ID。若加载的是解压后的开发版本，请传入 `chrome://extensions` 显示的 ID：

```bash
./desktop/macos/Scripts/install.sh --browser chrome --extension-id 你的扩展ID
```

Edge 使用 `--browser edge`。脚本会：

1. 构建 `Panelize Search.app` 并安装到 `~/Applications`；
2. 写入当前用户的 Native Messaging host 配置，只允许指定扩展 ID；
3. 打印后续步骤。安装不需要 `sudo`，也不会自动加入登录项。

安装后重新加载 Panelize 扩展（或重启浏览器），再打开一次应用：

```bash
open "$HOME/Applications/Panelize Search.app"
```

在 Panelize 的设置中打开 **“全局快捷输入（macOS）”**，开启 **“启用全局输入桥接”**。该桥接默认关闭，开启前扩展不会启动应用，也不会维持原生心跳。开启后，浏览器重新连接时会按需在后台启动应用。可选：在“系统设置 > 通用 > 登录项”中把它加入登录启动。若从菜单栏主动退出应用，浏览器不会自动重新拉起它；下次需要手动打开一次。

## 使用

- `Option + Space`（默认）或菜单栏里的“打开快捷输入”唤出浮动窗。
- 输入问题，按 `Enter` 发送给所有 AI。
- 发送按钮旁可选择内置提示词模式，默认“自动”。选择保存在本机，只影响当次发送，不会修改扩展里保存的模式。“自动”仅在问题包含 `/study` 等触发词时追加对应模式；“默认”不追加任何内容。
- `Shift + Enter` 换行；`Esc` 关闭。
- 可在菜单栏图标中选择改用 `Command + Shift + Space`。
- 发送成功后会显示“已发送至 N 个 AI”，并在约 1 秒后自动关闭；失败时保留输入内容并显示原因。

若 Panelize 页面尚未打开，扩展会先打开它，等待 AI 面板就绪后再发送。浏览器未运行、扩展未重新加载或本地桥未安装时，浮动窗会显示“浏览器未连接”，不会把未发送显示成成功。

## 安全与限制

- 桌面应用与扩展只通过本机 Unix socket 通信；socket 目录权限为 `0700`，socket 与一次性 token 为 `0600`。
- Native Messaging host 只接受安装时指定的扩展来源，不提供 shell、任意 URL 或文件访问接口。
- 浏览器必须保持运行；退出浏览器后无法发送。
- 本地构建使用 ad-hoc 签名，未做 Developer ID 签名与公证。自行从源码构建不会经过网络分发；若要公开分发，需要另行签名和公证。
- 应用显示期间会暂时作为普通 macOS 应用取得键盘焦点，关闭后恢复为仅菜单栏应用。

## 排错

**一直显示“浏览器未连接”**

1. 确认 Panelize 版本不低于 2.60.0，在扩展管理页重新加载，并在设置中开启“全局快捷输入（macOS）”。
2. 确认安装时使用的扩展 ID 与 `chrome://extensions` 一致；解压安装每次路径变化可能导致 ID 变化。
3. 检查 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.panelize.global_sender.json` 是否存在，且 `path` 指向 `~/Applications/Panelize Search.app/Contents/MacOS/PanelizeSearchBridge`。
4. 完全退出并重新打开 Chrome，再打开一次应用。

**快捷键没有反应或提示被占用**

在菜单栏图标中选择另一个快捷键。`Option + Space` 可能被其他输入法或快捷工具占用。

**构建失败**

先确认 `xcode-select -p` 指向有效的 Command Line Tools，再执行：

```bash
swift test --package-path desktop/macos
./desktop/macos/Scripts/build-app.sh
```

## 卸载

1. 从菜单栏退出应用。
2. 删除 `~/Applications/Panelize Search.app`。
3. 删除 Native Messaging 配置：
   `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.panelize.global_sender.json`
   （Edge 对应 `Microsoft Edge/NativeMessagingHosts`。）
4. 可选：删除 `~/Library/Application Support/Panelize Search/`（只包含本地桥的 socket 与 token）。

## 开发

```bash
swift test --package-path desktop/macos
./desktop/macos/Scripts/build-app.sh
```

构建产物在 `dist/Panelize Search.app`，不会进入扩展发布包。扩展侧的协议测试在 `tests/global-send.test.js` 与 `tests/native-send.test.js`。