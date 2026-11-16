---
description: "使用本地识别与按需下载的 Breeze TTS 2，与当前智能体进行语音对话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-voice-chat

[English](README.md) | 中文

## 概述

在现有输入框旁开启连续语音对话。停顿后，识别文字通过正常 Session 提交流程发送；助手的可见回复会转为语音，开口即可打断播报。只有点击“下载并准备”后才下载模型。本地 Breeze 当前需要至少 12 GB 内存的 Apple Silicon Mac。

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

启用[语音输入 Bundle](../voice-input-bundle/README.zh.md)，然后打开发送按钮旁的“实时语音”。“下载并准备”会准备识别模型和 Breeze。“开始对话”申请麦克风；“结束对话”或关闭面板释放录音和播放。切换 Session、隐藏页面、断开连接和禁用插件也会停止录音。结束语音模式会保留已经提交的文字任务继续运行。

自动选择在内存低于 32 GB 时使用 MLX 4-bit，在 32 GB 及以上使用 MLX 8-bit。模型文件分别约 3.0 GB 和 4.6 GB，另需托管 Python 运行时、依赖与识别模型。显式设置 `model: mlx-8bit` 至少需要 24 GB 内存。不支持的硬件会在下载前得到提示；插件不会切换到云端服务。[Breeze 模型许可](https://huggingface.co/BreezeBlue/Breeze-TTS-2/blob/main/LICENSE)将权重和自行部署的生成结果限制为研究及非商业用途。

Bundle 在 Harness 主目录下提供绝对路径 `dataRoot`。`modelOrigin` 接受兼容 Hugging Face 的来源，例如 `https://hf-mirror.com`。`instruction` 和 `cfgScale` 控制声音表现。`speechThreshold`、`minimumSpeechMs`、`silenceMs` 和 `preRollMs` 控制说话检测；`maxUtteranceSeconds` 限制单次录音。`idleTimeoutMs` 默认在闲置五分钟后释放模型内存；零表示保持加载。模型和运行时文件保留在缓存中。准备与推理分别具有可取消的时限。开始对话时会静音预热语音模型；将 `warmupText` 设为空可禁用预热。来源支持 HTTP 字节范围时，`downloadConnections` 和 `downloadChunkBytes` 限制并行下载。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

浏览器拥有一组启用回声消除的 AudioWorklet 录音和 Web Audio 播放生命周期。基于采样时钟的检测保留有界的起始音频并抑制短噪声。识别复用现有语音 Remote；正常 Session 提交记录识别后的文字。Chat 发布的快照仅将可见助手文字传给单调前进的句子游标，因此不会朗读历史、重复快照、思考过程或工具调用。播放和合成队列均有上限。无法确认发送结果的识别文字会保留，供手动插入；插件不会自动重试发送。

Host 在接受模型缓存前校验固定文件大小与 SHA-256。显式准备安装固定版本 uv、独立 Python 和 MLX Audio，不修改系统 Python。一组带认证的本机回环工作进程生成单声道 24 kHz PCM16；取消或失败的推理会等待工作进程终止，再允许后续合成。HTTP 分块结束标记区分完整响应和截断音频流。下载以原子方式发布，已验证完成的文件在重试时保留。随包配置不增加模型工具或智能体循环分支。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[语音输入子系统](../../../docs/subsystems/voice-input.zh.md)、[SenseVoice 准备](../speech-to-text-sensevoice/README.zh.md)和 [Breeze TTS 2](https://github.com/breezeblue-ai/breeze-tts)。

-----

<a id="model-experience"></a>
## 模型体验

### 识别后的话语

#### 模型看到的内容

识别语音在自动提交后成为普通 `user/message` 文字。麦克风采样、播放字节和准备状态不进入模型请求。当前聊天模型和工具保持不变。

#### Token 影响

每次提交将识别文字作为用户消息加入；静音和未确认的噪声不会增加消息。

#### KV 缓存影响

识别消息追加到 Session 历史，不改写先前消息。语音合成不增加模型上下文；其他插件和 Provider 决定缓存可用性。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 本地推理当前仅支持 Apple Silicon。Intel Mac、Windows、Linux 和较低内存的机器会提示不支持；不会安装 GGUF 或 CUDA 运行时。
- 每段说话结束后进行识别。说话检测使用音量与静音时长，而非语义轮次预测。使用耳机有助于避免扬声器回声造成误打断；实际延迟取决于本机硬件。
- 本包不提供声音克隆、唤醒词、识别过程中的实时字幕，以及思考过程或代码块的语音合成。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
