---
description: "通过设置启用并配置图片生成。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-image-generation-bundle

[English](README.md) | 中文

## 概述

通过设置为 Web 或 Desktop 对话加入生图能力。配置自己的生图接口地址、图片模型和 API Key，再开启对话生图。该能力默认关闭，每次请求使用你自己的服务账号。生成的图片会直接显示在对话中，并保留在会话历史里。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>

## 使用本包

打开插件 → **扩展工具** → **图像生成**，通过开关启用插件。在详情页填写自己的完整生图接口地址、图片模型和 API Key，勾选 **启用对话生图** 后保存。表单直接编辑自定义值，不提供服务商预设或恢复默认控件。默认比例选择器提供方形、横图、竖图和超宽横图选项；兼容 Images API 保留默认像素尺寸输入框。已有像素尺寸会显示为对应比例，保存值保持不变。对话中明确指定的尺寸或比例优先于保存的默认值。对话未指定时使用默认值；选择 **不指定** 或清空尺寸输入框后，则交给服务选择。配置的协议支持质量参数时也会显示质量字段。只有保存包含模型和密钥的启用配置后，生图工具才会开放。停用插件后，卡片仍保留在扩展工具分组中。卡片停用时显示已停用，仅在当前配置不完整时显示待配置；配置完成或暂时不可用时不显示待配置标签。

API Key 保存在当前 Host，不会回传浏览器；表单只显示是否已配置。之后修改配置时，将密钥输入框留空即可保留原密钥。保存无效值时会保留输入，供你修改。配置和开关实时生效，已在执行的请求继续使用其开始时的配置。

回到对话中描述需要的图片，例如：“生成一幅水彩插画，一只猫坐在窗边读书。” 调用成功后，图片会显示在工具行下方；若对话的过程区域已收起，展开后即可查看。点击预览可打开现有图片查看器，重新打开对话时会加载已保存的附件。

[工具配置](../tool-image-generation/README.zh.md#use-this-package)说明服务参数，并提供私有配置模板。关闭此组合后，后续请求不再提供生图工具。

-----

<a id="understand-the-implementation"></a>

## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[`cordis.patch.yml`](cordis.patch.yml)插入默认关闭生图的 `tool-image-generation`。Web 和 Desktop 独立加载浏览器配置入口，因此关闭运行时组合后 `plugins.bundle.config` 仍保持注册。工具的 volatile Config 字段在关闭生图时仍可编辑。一次带修订号的原子操作保存所有暂存字段。启用操作复用插件管理器的组合包开关。现有工具和附件视图显示已保存的结果。
</details>

-----

<a id="further-exploration"></a>

## 进一步探索

- [图片生成包组](../README.zh.md) — 能力导航。
- [图片生成工具](../tool-image-generation/README.zh.md) — 服务配置与失败处理。
- [配置方案组合](../../boot/app-boot/README.zh.md) — 可选层的加载。

-----

<a id="model-experience"></a>

## 模型体验

间接地，通过[图片生成工具](../tool-image-generation/README.zh.md)影响模型，该工具负责工具定义和结果内容。

#### KV Cache 影响

工具负责可见性变化对请求前缀的影响，以及追加的结果历史。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 开启工具前必须配置服务密钥和模型；仅启用组合时，生图工具仍保持关闭。
- 此组合提供文生图能力。图片编辑和服务商专用请求字段需要额外支持。

-----

<a id="dev-note"></a>

### 开发备注

<details>
<summary>维护者说明 — 点击展开</summary>

无。

</details>
