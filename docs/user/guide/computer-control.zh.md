# 电脑控制

[English](computer-control.md) | 中文

使用可选的统一 provider，在 Harness 会话中控制浏览器标签页和 macOS 应用。统一的 `computer` 工具负责观察目标、执行输入并返回当前状态。

## 前置条件

使用 macOS 源码仓库、仓库支持的 Node 版本、已安装的工作区依赖和 Chrome。按常规配置模型。声明支持图像输入的模型可以接收截图；文本模型可通过 `screenshot: false` 使用浏览器无障碍状态和原生元素。

Windows 和 Linux 可以使用浏览器目标；原生应用控制要求 macOS。选择原生操作前，检查返回结果中的 `capabilities.native`。开启“每次电脑操作前确认”，可对列出目标和读取状态以外的每次动作单独审批；开关立即作用于所有对话。

在“系统设置 → 隐私与安全性”中，为启动 Harness 的应用授予辅助功能权限。原生截图还需要该应用的屏幕与系统音频录制权限。浏览器截图通过 Playwright 获取，不需要此原生录制授权。provider 不会修改操作系统权限。

## 从插件页启用

打开 **插件 → 扩展工具 → 电脑控制**，开启开关，再进入卡片。开启“显示 Agent 独立光标与按键提示”，即可观看操作。选择已安装的浏览器，保持浏览器窗口可见，初次用文本模型测试时关闭截图。保存修改后，新建对话以应用运行默认值。操作模式与输入审批的修改对已有对话的下一次操作生效。

在新对话中先检查权限和窗口，不发送输入；再测试浏览器：打开 Example Domain，读取标题和主标题，创建第二个标签页并仅关闭第二个；最后先选择**前台系统操作**并保存，再新建空白的“文本编辑”文稿，用原生测试指令输入并回读文本，不保存文件。展开对话中的过程详情，可以查看 `computer` 调用和结果。

浏览器测试成功时，应报告两个标签页，且第一个保持打开。原生测试成功时，文稿含有所要求的文本，返回状态也能读到它。模型额度或余额不足发生在这些操作之前；请在“设置 → 模型”修复账号后重新发送测试。

### 观看画中画

Agent 选择目标后，对话右上角显示**电脑画中画**。它展示目标窗口或页面的真实画面、光标和当前操作。悬停在画面上可显示图标控件，拖动画面可调整位置；按钮可放大、还原、收起或关闭。关闭后可通过对话标题栏的预览按钮重新打开。关闭或收起只会停止截图，Agent 继续工作。截图失败时保留上一帧并显示暂不可用提示。即使关闭发给模型的截图，原生窗口预览仍需要屏幕与系统音频录制权限。预览帧不会发给模型，也不会存入会话。

## 启动会话

在仓库根目录，通过常规 `dsh` 启动器选择可选补丁：

```sh
pnpm dsh headless --patch apps/cli/config/examples/computer-use-unified.patch.yml "Use computer to list available targets and report whether desktop control is available in this mode. Do not send input."
```

将任务文本替换为你要执行的流程。Web UI 在完成常规 Web 构建后，可使用同一补丁选择 `web`。请用此 provider 替代其他 browser-use 或 computer-use provider。默认配置不启用它。

此 provider 打开独立浏览器配置，并跨调用保留标签页。它不会读取你当前的 Chrome 标签页或浏览器登录状态。每个活跃会话拥有独立浏览器。原生窗口仍与桌面用户共享。

## 完成浏览器任务

让 Agent 打开网页、填写字段、提交并检查可见结果。以下工具调用展示定位顺序；请替换为你要操作的网页 URL 和无障碍名称。

```json
{"action":"open_browser","url":"https://example.com","screenshot":false}
```

读取返回的目标 ID 和无障碍树，后续输入使用该目标及准确观察到的定位器：

定位器必须命中最近 `fields` 或 `geometry.elements` 包含的元素。导航或元素被替换后重新观察。切换编辑器时使用显式定位器。坐标输入默认要求 30 秒内的截图；收到 `SCREENSHOT_EXPIRED` 时重新截图。

```json
{"action":"type","target":"tab-1","locator":{"by":"role","role":"textbox","name":"Task name"},"text":"Computer control","replace":true,"screenshot":false}
```

成功的操作返回新观察。检查其中的预期值或可见成功信息。点击已投递并不表示保存或提交已完成。`new_tab` 打开另一个独立标签页；`close_tab` 仅关闭指定的独立标签页。

## 操作 macOS 应用

请先在电脑控制中选择**前台系统操作**并保存，再发现桌面目标。CLI 示例补丁需在 `computer-use-unified.config` 下设置 `inputMode: foreground`。使用 `list` 发现窗口和权限，然后对所选窗口执行 `observe`。点击和输入时，将返回的 `element_token` 作为 `ref`。新观察会替换旧引用。使用带准确 bundle ID 的 `open_app` 启动所选应用。

```json
{"action":"open_app","bundleId":"com.apple.TextEdit"}
{"action":"observe","target":"window-1","screenshot":false}
```

原生测试需要实际的应用窗口。使用 `open_app` 返回的进程和目标，再通过 `observe` 确认输入框及按钮后发送输入。测试应用已退出时，按准确的应用包标识重新启动。找不到该应用或所需控件时停止。

将 `window-1` 替换为 `open_app` 实际返回的目标。应用启动使用插件的**启动与导航超时**，默认为 30 秒。没有就绪窗口或启动超时时，先调用 `list` 检查应用状态，再决定后续操作。

电脑控制默认使用**网页后台**，不发现或操作桌面应用。操作 macOS 应用前，请选择**前台系统操作**并保存，再重新列出目标。前台动作会激活准确目标并使用系统鼠标和键盘，执行期间请避免同时使用桌面。`NATIVE_FOREGROUND_REQUIRED` 表示尚未派发桌面操作。浏览器 JavaScript 弹窗仍使用独立后台反馈。点击**停止生成**可取消后续输入，已投递输入保留。坐标操作需要准确目标的最新截图。`inputMode` 仅表示请求的设置，不是实际窗口焦点的测量结果。

## 恢复与结束

目标缺失或过期时，应重新执行 `list` 和 `observe`。网页对话框需要显式 `dialog` 操作，指定 `accept: true` 或 `accept: false`。失败或取消的输入可能已改变应用；再次尝试前先检查当前状态。网页加载缓慢或截图失败时保留浏览器。结果报告 `browserStatus: open` 时，使用已有目标并设置 `screenshot: false` 重新观察；连续失败时报告问题，不要重置或重开。取消前台输入会保留窗口；取消页面输入时可能关闭独立浏览器，使相关标签页失效。

使用 `reset` 关闭会话的独立浏览器并释放原生引用。用户应用保持打开。恢复会话后需要重新发现目标。[包参考](../../../packages/experimental/computer-use-unified/README.zh.md)定义配置、失败字段和其余限制。
