---
description: "为独立启用的浏览器和应用操作提供仅用于显示的预览。"
kind: package-reference
---

# @deepseek-ai/dsh-experimental-computer-preview

[English](README.md) | 中文

## 概述

通过可独立移动和调整大小的画中画查看浏览器和应用操作。所属的控制插件自动挂载此内部界面插件；它不会启动操作运行时，也不提供模型工具。

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

在插件页启用浏览器操作或应用操作，各自的组合层都包含此载体，用户无需单独启用。客户端提供 `computerPreviewUi`，各来源按自己的生命周期和来源标识注册截图回调。宿主不包含设置、工具或截图副作用。

目标可用时自动显示画中画。拖动画面可在应用窗口内移动，拖动任一下角可调整大小。「最大化」铺满可用窗口并保持画面比例；「还原」恢复之前的小窗尺寸和位置。「收起」暂停截图并保留展开按钮。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节，点击展开</summary>

宿主导出截图注册表，每个控制插件以独立的远程服务和实时刷新设置挂载。注入的客户端服务通过会话范围的顶部插槽挂载浮层，不添加顶部按钮。每个面板保留独立的显示状态，并在收起或卸载时取消待完成的读取。共享几何计算保持图片比例，将小窗约束在视口内，并避让桌面标题栏。截图所有权和远程认证仍由来源插件负责。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [浏览器操作](../browser-control/README.zh.md) — 隐藏浏览器来源。
- [应用操作](../computer-control/README.zh.md) — 原生前台来源。

-----

<a id="model-experience"></a>
## 模型体验

无，因为仅用于显示的预览图片和控件不会进入模型请求或会话日志。

#### KV Cache effect

无。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 截图失败、权限和刷新频率由各来源负责。
- 面板仅用于显示；操作输入通过所属控制工具执行。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者上下文，点击展开</summary>

无。

</details>
