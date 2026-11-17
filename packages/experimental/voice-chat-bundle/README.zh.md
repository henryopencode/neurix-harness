---
description: "独立于听写启用本地实时语音对话。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-voice-chat-bundle

[English](README.md) | 中文

## 概述

在插件页启用“实时语音”，即可使用 SenseVoice 与 Breeze TTS 2 连续对话。独立的“语音输入”开关控制听写。两项功能共享识别资源；只有显式准备才会下载模型。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在插件页启用“实时语音”，在插件详情中选择输入与识别设置，再点击“下载并准备”。空输入框显示语音波形；输入内容后恢复发送按钮。桌面版最小化后在原生悬浮窗中保留语音控件。关闭此 Bundle 会结束录音与播放；如果“语音输入”仍启用，普通听写可继续使用。至少 12 GB 内存的 Apple Silicon Mac 可以准备本地 Breeze 权重；不支持的 Host 会在下载前提示硬件要求。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

补丁组合共享语音服务、本地 SenseVoice Provider、浏览器转写 API 和语音对话插件。语音条目与听写 Bundle 使用相同 id 和配置，因此同时启用只创建一组识别器和 API 命名空间。合成在 Harness 主目录下拥有独立缓存。[实时语音包](../voice-chat/README.zh.md)拥有运行环境准备与播放。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[语音输入子系统](../../../docs/subsystems/voice-input.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

通过实时语音消费者间接影响模型：识别后的话语作为普通用户消息提交。

#### KV 缓存影响

没有直接影响；普通提交拥有消息内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 本地 Breeze 当前仅支持 Apple Silicon。[实时语音限制](../voice-chat/README.zh.md#known-limitations-and-deferred-work)说明内存、许可和轮次检测要求。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
