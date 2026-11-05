# 项目结构与开发导航

Panelize Plus 包含浏览器扩展和可选的 macOS 全局输入客户端。浏览器扩展直接从仓库根目录加载，无需构建；桌面客户端由 SwiftPM 构建。

## 从哪里开始

| 修改内容 | 入口与实现位置 |
| --- | --- |
| 多面板页面 | `multi-panel/multi-panel.js` 组装控制器，`multi-panel/controllers/` 实现各功能 |
| 设置页 | `options/options.js` 组装控制器，`options/controllers/` 按设置区域划分 |
| 后台事件 | `background/service-worker.js` 注册事件，`background/controllers/` 处理业务 |
| 供应商页面交互 | `content-scripts/providers/` 的适配器，以及 `content-scripts/features/` 的功能处理器 |
| 通用业务能力 | `modules/` 下对应领域的 ES module |
| macOS 浮窗 | `desktop/macos/Sources/PanelizeSearchApp/Composer/` |
| 原生通信协议 | `desktop/macos/Sources/PanelizeSearchCore/Bridge/` |
| 测试与发布工具 | `tests/`、`scripts/release/`、`scripts/assets/` |

## 三种执行环境

### 扩展页面与 Service Worker

多面板、设置页和后台使用原生 ES module。入口负责组装依赖、初始化和注册顶层事件；控制器拥有功能状态，共享模块提供业务规则、存储访问和通用工具。

页面控制器通过显式注入的方法、getter 和回调协作。需要在事件中访问另一个控制器时，使用延迟 getter，保证全部控制器完成组装后再读取依赖。控制器不导入页面入口，不在共享模块中保存页面实例。

多面板保留 `broadcastMessage` 和 `sendToPanel` 导出，委托发送控制器执行。现有页面 URL、DOM 标识、消息字段和存储键是兼容边界。

### 供应商页面 Content Script

Chrome 按顺序加载普通脚本，这些脚本不能直接使用 ES module 的 `import`。拆分后的文件通过扩展隔离环境中的 `PanelizeContent.factories` 注册工厂，由兼容入口统一组装并启动。

加载顺序：共享 namespace → 运行时与协议 → 供应商适配器 → 功能处理器 → 启动入口。注册工厂本身不安装事件监听；启动入口在同一文档内只运行一次。新文档会创建新的隔离环境。

`modules/providers/content-script-files.js` 保存有序清单：

- `TEXT_INJECTION_FILES`：输入、附件、新会话、回答追踪、截图等能力。
- `PROVIDER_TIER_FILES`：模型与推理档位的发现、菜单、滑块和配方执行。
- `expandContentScriptFiles()`：将稳定入口文件名展开为完整依赖序列，并去重。

静态 manifest、可选供应商动态注册和测试加载器使用相同顺序。manifest 是直接加载的 JSON；调整清单后须同步其脚本数组，加载契约测试会核对两者。`world: MAIN` 的脚本保持独立，不使用隔离环境中的 namespace。

### macOS 客户端

保留三个产品/业务 target：

| Target | 职责 |
| --- | --- |
| `PanelizeSearchCore` | 协议、输入校验、提示词模式、历史记录和布局计算 |
| `PanelizeSearchApp` | 应用生命周期、菜单、快捷键、浮窗和 socket 服务端 |
| `PanelizeSearchBridge` | 浏览器 Native Messaging 流与本机 socket 之间的转发 |

浮窗内部：`SearchPanelController` 协调显示、关闭和发送；`ComposerContent` 构建视图并转发动作；`ComposerSuggestions` 管理历史建议和补全；`ComposerLayoutController` 管理输入高度、历史面板与窗口尺寸。视图组件单独放在 `Composer/Views/`。

`BridgeServer` 管理请求和连接状态，`UnixSocketServer` 负责底层服务端通信。原生宿主由 `NativeBridgeHost` 协调，`NativeMessageIO` 与 `UnixSocketClient` 分别处理浏览器流和 socket I/O。

## 共享模块如何归类

| 子目录 | 内容 |
| --- | --- |
| `providers` | 供应商目录、默认值、排序、权限、会话、URL 和档位配置 |
| `panels` | 布局、缩放、调整大小、启动恢复、就绪状态及面板操作结果 |
| `composer` | 输入控件、附件、文本注入和键盘快捷键 |
| `prompts` | 提示词库、提示词模式和最近提问 |
| `answers` | 回答统计、问答记录、任务分类、摘要及缓存 |
| `snapshots` | 截图触发、采集、拼接、绘制和 tab capture |
| `platform` | 设置、语言、主题、消息、版本、打开模式、全局发送与评分提醒 |
| `shared` | HTML、URL 和指针等小型工具 |

页面 DOM 渲染与业务规则分开。新增通用模块放入所属领域；仅服务某个页面的逻辑放入该页面控制器目录。

## 全局发送链路

```text
macOS 浮窗
  → BridgeServer / Unix socket
  → NativeBridgeHost / Native Messaging
  → background 的 native-bridge 与 page-actions
  → multi-panel 的 messaging 与 sending
  → 供应商 content script
  → 实际结果沿原链路返回
```

请求 ID、握手、来源校验、就绪门槛、超时和最终发送结果均由现有协议负责。扩展存储、浏览器登录态和 macOS 偏好设置维持各自原有位置。

## 样式与资源

两个页面的原 CSS 文件保留为有序 `@import` 入口。`styles/` 中的文件按原连续区块拆分，后面的规则可能有意覆盖前面的规则，因此不要仅按名称重新排序。

CSS 的 `url()` 相对其自身文件解析；移动规则时需同步字体和图片路径。静态源码检查会跟随 ES module 和 CSS 导入，覆盖拆分文件。

## 新增或调整供应商

1. 更新 `modules/providers/` 中的目录、默认值、权限与 URL 规则。
2. 在供应商目录实现适配器，保留现有输入、发送、新会话和附件结果协议。
3. 将新的普通脚本加入有序清单及对应静态/动态注册；明确执行环境、加载时机和 frame 范围。
4. 添加本地页面夹具，验证输入、就绪、权限、附件与新会话；真实站点测试按需手动执行。

历史保留的 ES module 注入器不属于当前普通 content-script 启动链路；以 manifest 和动态注册清单判断实际入口。

## 测试与发布

```bash
npm run test:unit
npm run test:e2e
swift test --package-path desktop/macos
npm run release:package
```

- `tests/unit/` 按领域组织；Vitest 只发现这里的用例，避免扫描本地嵌套工作副本。
- `tests/helpers/` 保存源码读取和浏览器 API 测试支持。
- `tests/e2e/support/` 保存临时扩展、浏览器和本地服务工具；`fixtures/` 保存供应商页面。
- `tests/live/` 使用专用登录资料，仍是手动执行的真实站点测试。
- Swift Core 测试覆盖协议和纯逻辑；App 测试使用不显示的窗口及独立偏好设置验证组件交互。

E2E 默认加载当前仓库。验证解压发布包时，可将 `PANELIZE_E2E_EXTENSION_PATH` 指向其目录，再运行启动和发送相关用例。测试使用临时浏览器资料，不复用日常浏览器登录数据。

发布打包仅复制运行目录及明确列出的资源；桌面构建、测试、文档和本地工作副本不进入扩展 ZIP。npm 发布命令保持原名称，具体脚本归入 `scripts/release/`。
