---
description: "在插件页启用浏览器与 macOS 控制并配置默认值。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-computer-control

[English](README.md) | 中文

## 概述

在“插件 → 扩展工具”中启用电脑控制。配置浏览器、截图模式和超时后，在新对话中使用电脑控制。浏览器标签页和 macOS 窗口使用统一的 `computer` 工具。此插件默认关闭，并打开独立浏览器配置。原生应用访问需要启动宿主的 macOS 权限。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

打开“插件 → **扩展工具** → **电脑控制**”。打开插件开关，再进入详情页。“实验性”标记表示发布状态；关闭时卡片仍保留在图像生成旁边。停用插件会移除工具并关闭其独立浏览器资源。

默认“网页后台”模式仅操作浏览器标签页。桌面应用必须由用户明确选择“前台系统操作”；本插件不提供实验性的原生后台入口。开启“显示 Agent 独立光标与按键提示”可观察动作。“停止生成”会取消后续输入，已投递动作保留。网页后台模式中的桌面发现、启动和输入会在访问桌面前报告 `NATIVE_FOREGROUND_REQUIRED`。选择已安装的浏览器，关闭“隐藏浏览器窗口”即可观看页面。默认关闭截图，文本模型可先通过无障碍状态操作。仅在模型支持图像输入时开启截图。原生截图需要宿主的屏幕与系统音频录制权限；原生操作需要辅助功能权限。浏览器截图使用 Playwright。

**启动与导航超时**同时适用于原生应用启动、浏览器启动和导航。运行默认值在首次使用时读取。操作模式的修改对已有对话的下一次操作生效；其他默认值需要新建对话。已打开的标签页保留。字段显示生效值，不显示覆盖标签或恢复默认操作。无效值保留在表单中；保存被拒绝时保留草稿。

**每次电脑操作前确认**默认关闭，修改后立即作用于所有对话。开启后，除列出目标和读取状态外，每次动作都需要独立的一次性审批；审批通道不可用时阻止输入。此设置不限制域名或应用范围。

Agent 选择目标后，对话右上角显示**电脑画中画**，展示目标的真实画面、软件光标和操作状态。“网页滚动时长”设置控制浏览器原生连续滚轮手势；操作期间预览会更频繁地刷新。原生应用控件读取预算可调整，适用于控件树较大的应用。可见的 macOS 网页和原生应用共用独立窗口覆盖层，同一份光标、点击、拖动、键盘和滚动状态驱动画中画。输入时显示已投递的当前按键，投递前只显示键盘图标。浏览器弹窗使用完整主窗口图像，使按钮坐标保持一致。滚动时，预览和 Agent 光标旁显示滚动方向，输入停止后淡出。悬停时显示图标控件，可拖动画面、放大或收起；关闭后可通过对话标题栏的预览按钮重新打开。关闭或收起只会停止预览截图，Agent 继续工作。截图失败时保留上一帧并显示暂不可用提示。预览仅供观看，不增加模型输入或会话事件。

### 在对话中测试

同一会话的并发观看者共享正在进行的一次截图。没有目标时使用 `previewIdleIntervalMs`（默认 2000 毫秒）；已有目标和活动目标分别使用 `previewIntervalMs` 和 `previewActiveIntervalMs`。最后一位观看者离开时取消并等待截图结束。截图失败区分权限缺失、超时和图片过大，同时保留上一帧。

按照[电脑控制指南](../../../docs/user/guide/computer-control.zh.md)在对话中测试权限、浏览器标签页和原生应用输入。指南说明预期结果和恢复方式。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

[补丁](cordis.patch.yml)插入隔离的 browser-use 和 computer-use 注册表，以及可配置的 provider。宿主通过设置解析器挂载[统一运行时](../computer-use-unified/README.zh.md)。每个 Agent 获取资源时读取一份经验证的配置；每次操作重新解析输入模式。共享原生队列串行执行桌面调用。浏览器端使用已有设置表单和字典注册一个插件配置插槽，并随插件卸载。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [统一电脑运行时](../computer-use-unified/README.zh.md) — 操作、失败和资源管理。
- [插件管理](../../boot/plugin-manager/README.zh.md) — 激活与配置持久化。
- [电脑控制指南](../../../docs/user/guide/computer-control.zh.md) — 手动测试。

-----

<a id="model-experience"></a>
## 模型体验

间接通过[统一 provider](../computer-use-unified/README.zh.md)影响模型；该 provider 维护电脑工具、指引和结果。

#### KV Cache 影响

provider 维护启用或停用工具与指引时的前缀变化，以及仅追加的结果历史。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 浏览器和原生应用的限制由统一 provider 定义。不会导入已有 Chrome 标签页或登录状态。
- 操作模式、审批策略和预览频率立即生效；其他保存的运行时默认值适用于下一个获取资源的 Agent。
- 详情表单仅在插件启用时可用。macOS 权限仍需通过操作系统授予。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者上下文 — 点击展开</summary>

无。

</details>
