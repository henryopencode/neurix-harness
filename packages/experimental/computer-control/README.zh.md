---
description: "在插件页启用 macOS 前台应用操作并配置默认值。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-computer-control

[English](README.md) | 中文

## 概述

在 macOS 前台使用可见的鼠标和键盘输入操作应用，也包括浏览器应用窗口。在插件页启用此可选插件，并独立配置审批、输入提示和截图。画中画跟随当前应用。隐藏的 Playwright 会话由独立的浏览器操作插件提供。

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

打开 **插件 → 扩展工具 → 应用操作**，启用后即可使用 `application` 工具。它支持 macOS 应用，包括作为原生应用窗口操作的 Chrome 和 Safari。操作会激活精确的目标窗口，并使用系统鼠标和键盘。**停止生成**会取消后续输入；已经送达的输入仍然保留。Windows 和 Linux 用户可以启用独立的[浏览器操作](../browser-control/README.zh.md)插件。

请为启动 Harness 的应用授予辅助功能权限。截图和画中画还需要屏幕与系统音频录制权限。仅在使用支持图像输入的模型时开启截图；关闭模型截图仍可查看画中画。保存的运行默认值在新对话中生效，审批和预览频率立即生效。

**每次应用操作前确认**默认关闭。启用后，除 `list` 和 `observe` 外，每项操作都需要单次审批。审批通道不可用时，输入会被阻止。高级设置包含操作超时、应用启动超时和原生控件读取预算。指针、滚动、输入和预览的时间参数仍可通过配置补丁调整。

应用画中画显示选中的原生窗口及输入反馈。拖动图片可移动窗口，拖动任一底角可保持比例调整大小，不裁剪图片。聚焦底角后也可用方向键调整大小。收起会暂停截图，Agent 继续工作；展开后恢复截图。截图失败会保留最后一帧并提供重试。预览图片仅用于显示，不会加入模型输入或会话事件。浏览器操作拥有独立的画中画、审批和资源；两个插件可同时运行。

对话测试和恢复方法参见[电脑操作指南](../../../docs/user/guide/computer-control.zh.md)。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

[补丁](cordis.patch.yml)插入隔离的 computer-use 注册表和仅限应用的提供者。宿主以应用操作集和固定前台输入挂载[统一运行时](../computer-use-unified/README.zh.md)，此运行时拒绝启动 Playwright。每个 Agent 在获取资源时捕获经过验证的运行默认值；审批逐次读取当前策略。共享原生队列串行执行桌面调用。客户端通过现有设置表单和词典注册配置插槽，随插件一起卸载。

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

Web 应用提供共享的预览渲染器。不包含 `dsh-web-app` 的自定义 Web 组合必须自行挂载 `@deepseek-ai/dsh-client-ui-computer-preview`。

<a id="known-limitations-and-deferred-work"></a>

- 原生应用的限制由统一提供者定义。本插件通过原生控件操作现有浏览器窗口，绝不启动 Playwright。
- 审批策略和预览频率立即生效，其他保存的运行默认值在下一个获取资源的 Agent 中生效。
- 插件启用后可使用详情表单。macOS 权限仍须通过操作系统授予。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者上下文 — 点击展开</summary>

无。

</details>
