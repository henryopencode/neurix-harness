---
description: "选择并配置对话中的图片生成服务。"
kind: "package-group"
---

# image-generation/ — 根据对话提示词生成图片

[English](README.md) | 中文

## 概述

在对话中根据文字生成图片，并在会话历史中保留结果。选择 OpenAI 兼容 Images API 或 MiniMax，配置接口地址、模型和 API Key。插件 → 扩展工具 → 图像生成提供配置入口，可选生图工具通过现有附件存储保存图片。生成请求使用你配置的服务，可能产生该服务的费用。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>

## 包

GUI 用户选择组合包，自定义组合则直接加载工具包。

| 包 | 职责 |
|---|---|
| [`image-generation-bundle/`](image-generation-bundle/README.zh.md) | 设置中的生图配置与可选运行时启用 |
| [`tool-image-generation/`](tool-image-generation/README.zh.md) | 生成图片并返回已保存的附件 |

-----

<a id="related-documentation"></a>

## 相关文档

- [附件子系统](../../docs/subsystems/attachment.zh.md) — 持久存储与经过授权的图片访问。
- [配置方案组合](../boot/app-boot/README.zh.md) — 组合可选能力。

<a id="dev-note"></a>

## 开发备注

无。
