---
description: "通过独立的隐藏浏览器和画中画操作网页。"
kind: package-bundle
---

# @deepseek-ai/dsh-experimental-browser-control

[English](README.md) | 中文

## 概述

在 Windows、macOS 和 Linux 上使用独立的隐藏浏览器完成网页任务，并通过画中画查看过程。在插件页单独启用和配置。此插件不会接管日常浏览器的标签页或登录状态，应用前台操作由独立插件提供。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

打开 **插件 → 扩展工具 → 浏览器操作** 并启用。选择本机已安装的 Chrome、Chromium 或 Edge；默认 Chrome。浏览器始终隐藏，独立会话不导入日常浏览器的标签页、Cookie 或登录信息。这种会话隔离不是操作系统安全沙盒。

`browser` 工具只能操作它创建的标签页。应用操作插件可以同时启用，并使用独立的 `application` 工具、审批和画中画。浏览器插件不会调用原生应用控制。关闭插件或执行 `reset` 会关闭该会话的浏览器。

**每次浏览器操作前确认**默认关闭，保存后立即作用于所有对话；`list` 和 `observe` 自动执行，其余每项操作需要单次审批。审批不可用时阻止操作。仅在模型支持图像时开启**附带截图**；关闭它不影响画中画。其他运行设置需要新建对话，高级设置保留操作和启动与导航超时。

隐藏页面默认使用 1440×900 CSS 像素视口，可在 `browser-control` 配置中调整 `browserViewportWidth` 和 `browserViewportHeight`。画中画完整缩放当前视口，页面之外的内容需要滚动。拖动图片可移动，拖动任一底角或使用方向键可保持比例调整大小。收起会暂停预览截图，Agent 继续运行；展开后恢复截图。预览不发送给模型，也不写入会话。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节，点击展开</summary>

[补丁](cordis.patch.yml)插入隔离的 browser-use 注册表，并以浏览器操作集挂载[统一运行时](../computer-use-unified/README.zh.md)。执行器在审批和资源获取前拒绝原生操作。每个 Agent 拥有独立的浏览器和预览源池。客户端通过注入的预览服务共享画中画渲染器；应用插件保持独立启用状态。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [电脑操作指南](../../../docs/user/guide/computer-control.zh.md) — 对话测试和恢复。
- [应用操作](../computer-control/README.zh.md) — macOS 前台输入。

-----

<a id="model-experience"></a>
## 模型体验

通过[统一提供者](../computer-use-unified/README.zh.md)间接影响模型，该提供者拥有 browser 工具、指导和结果。

#### KV Cache effect

启用状态改变工具和指导前缀；结果以追加方式进入历史记录。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 浏览器须已安装；插件不会安装软件。
- 日常浏览器窗口和登录状态属于独立的应用操作插件。
- 会话隔离不会限制网页下载以外的全部系统能力，不能作为安全沙盒。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者上下文，点击展开</summary>

无。

</details>
