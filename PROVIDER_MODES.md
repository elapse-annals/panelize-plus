# AI 档位匹配

底栏提供“默认／快速／均衡／深度”。“默认”保留各 AI 自己的模式；选中其他档位后，扩展向当前已打开的面板批量应用对应配置。新对话和页面重新加载后，会重新应用所选档位。档位设置不会自动发送消息。

下表是**当前内置配置**，不代表每个账号都具备这些选项。型号、地区、套餐、额度和站点更新都会影响可用项；只有在网页上找到可见、可用的控件，并读回选择结果后，才计为成功。设置页的“档位匹配”可以修改各平台的模型、思考强度和开关步骤；清空某档配方表示该平台不参与该档切换。

## 当前配置

配方依次选择模型和思考模式；`／` 表示同一步的可选语言或别名。两个档位配方相同时，详情会明确显示共享映射。

| 平台 | 快速 | 均衡 | 深度 | 支持边界 |
| --- | --- | --- | --- | --- |
| ChatGPT | GPT-6 + Instant／即时 | GPT-6 + Medium／中等 | GPT-6 + High／高 | 先选模型再选思考强度；网页显示思考强度滑块时按档位移动滑块，否则从菜单选择。 |
| Claude | Effort Low | Effort Medium | Effort High | 优先选择推理强度。模型兜底仅在实际选择并验证后明确标记；只看见模型名不能确认推理强度。 |
| Gemini | 3.5 Flash-Lite + High | 3.8 Flash + High | 4 Argon + High | 按模型和思考强度逐步选择；三档思考强度均为 High，型号缺失时返回失败，可在设置页更新配方。 |
| Grok | — | — | — | 当前无内置档位切换，保留平台原设置。 |
| DeepSeek | 深度思考关闭 | 深度思考开启 | 深度思考开启 | 二态开关；均衡和深度共享同一实际模式，详情明确标注。 |
| Kimi | 快速／Fast + 进阶／Advanced | K2.8 + 进阶／Advanced | K3.1 + 进阶／Advanced | 模型和推理子菜单分别确认；账号未开放项不会假报成功。 |
| Google | — | — | — | Search／AI Mode 保持独立，不推断成推理档位。 |
| 豆包 | 动态探测 | 动态探测 | 动态探测 | 仅识别明确的模型／推理控件；无法识别时报告不支持。 |
| 千问中国 | Qwen3.6-flash + 快速 | Qwen3.7 + 思考研究 | Qwen3.7-Max + 快速 | 按原生模式标签执行配方，不使用 API 能力推断网页选项。 |
| Qwen Global | Qwen3.6-flash + 快速／Fast | Qwen3.7 + 思考研究／Thinking | Qwen3.7-Max + 快速／Fast | 菜单标签、锁态与账号可用项以网页为准。 |
| 智谱清言 | GLM-FLASH + 快速 | GLM-FLASH + 极致 | GLM-5.3 + 极致 | 模型和推理模式分别读回确认。 |
| Z.ai | GLM-FLASH／GLM-5.3-Flash + Fast | 同模型 + Max | GLM-5.3 + Max | 使用 Z.ai 网页控件，不把其他产品的参数视为网页支持。 |
| 元宝 | Hy3 + 深度思考关闭 | Hy3 + 深度思考开启 | DeepSeek + 深度思考开启 | 顶部模型菜单只显示“元宝”，按触发器的模型 ID 读回实际模型；深度思考为输入框开关。 |
| MiMo | 动态探测 | 动态探测 | 动态探测 | API 文档不作为网页控件支持的证明。 |
| StepFun | 动态探测 | 动态探测 | 动态探测 | 仅依据可见界面探测，尚未配置固定配方。 |
| Agnes | 动态探测 | 动态探测 | 动态探测 | 仅依据可见界面探测，尚未配置固定配方。 |
| Meta AI | 即时／Instant | 即时／Instant | 思考／Thinking | 快速和均衡共享即时模式；账号和地区可能限制选项。 |

模型与推理强度是不同维度。Claude 的 [模型、Effort 与 Thinking 说明](https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings)、Gemini 的 [模型与思考档说明](https://support.google.com/gemini/answer/18648722)、Kimi 的 [模型与模式说明](https://www.kimi.com/en/help/others/model-mode-selection) 描述了相应控件；[ChatGPT 更新说明](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) 说明了选择器档位。公开说明不能替代当前账号网页上的实际检查。

## 结果和重试

- 详情按所选档位展示每个面板的对应配置（共享映射、自动识别、不支持或不切换会明确标注），以及实际模式和结果；盲测模式下隐藏对应配置和实际模式。成功、暂不支持、账号或页面不可用、超时分别处理；部分成功显示混合状态。
- 切换过程中继续点击会保留最后选择；只有所有面板都确认后档位才显示为实心选中，部分成功、失败或不支持显示为 mixed。
- 快速使用短促青色光带，均衡使用蓝色光晕，深度使用紫色星光；动画有限时运行，并遵守系统“减少动态效果”设置。
- “重试未成功项”只重试未确认达到所选档位的面板。成功面板保留当前会话和模式。
- 切换时保留统一输入框草稿及附件。网页自身更改模型的行为受各平台控制；扩展不会为切换档位提交消息。
- 输入框边框只在聚焦或切档时短暂流光，随后回到静态状态；系统启用“减少动态效果”时关闭流光。

## 消息契约

宿主发送 `GET_PROVIDER_TIER_STATE` 或 `SET_PROVIDER_TIER`，包含 `requestId`、`context:'multi-panel'`、目标档位和对应配方。内容脚本只接受父窗口及扩展 origin 的请求，响应 `PANELIZE_PROVIDER_TIER_STATE` 或 `PANELIZE_PROVIDER_TIER_RESULT`。

响应包含平台、实际档位、`actualLabel`、`supportedTiers`、`matchedTiers`、`status` 和可选失败原因。`matchedTiers` 表达共享同一真实模式的档位。宿主按 iframe source、origin、平台和请求 ID 匹配结果，并通过每面板加载代次丢弃旧文档回包。状态为 `success`、`unsupported`、`unavailable`、`timeout` 或 `error`；失败不能作为已经切换的证据。

批量新对话另用 `NEW_CHAT`／`VERIFY_NEW_CHAT` 和 `PANELIZE_NEW_CHAT_RESULT`。点击或开始导航不代表成功；内容脚本确认稳定空会话，导航恢复时还需确认处于平台新对话路径。未确认项可单独重试，统一草稿和附件保留。
