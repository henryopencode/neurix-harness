---
description: "使用本地识别与按需下载的 Breeze TTS 2，与当前智能体进行语音对话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-voice-chat

[English](README.md) | 中文

## 概述

在插件页准备本地语音模型，再从空输入框开启连续语音对话。停顿后，识别文字通过正常 Session 提交流程发送；助手的可见回复会转为语音，开口即可打断播报。只有点击“下载并准备”后才下载模型。本地 Breeze 当前需要至少 12 GB 内存的 Apple Silicon Mac。

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

启用[实时语音 Bundle](../voice-chat-bundle/README.zh.md)，打开**插件 → 自定义插件 → 实时语音**。选择麦克风、识别服务、语言和音色：自然、温柔女声或沉稳男声。页面显示根据硬件选择的 Breeze 模型，以及各服务的准备状态。“下载并准备”显式准备识别资源与 Breeze。打开配置页不会占用麦克风；“检测麦克风”申请权限、列出设备，并释放检测时的录音资源。麦克风与音色偏好保存在当前浏览器中，与语音输入插件的偏好独立。每次对话保持启动时选定的音色。

空输入框显示波形按钮，输入文字或添加附件后恢复发送按钮。进入语音模式后，语音球出现在项目栏上方，项目栏保持原位。扬声器、麦克风和结束按钮位于模型选择器旁，聊天记录和草稿仍可使用。模型尚未准备时，波形按钮打开插件配置。预热完成后，球内动态随麦克风音量变化。语音消息被接收时球会闪一下，思考或播报时通过球内动画反馈，不显示聊天区的处理状态。扬声器开启时，启动、发送语音消息和结束各有不同的提示音。开口会打断播报，结束语音后已提交的任务继续运行。

最小化桌面窗口后，对话通过悬浮语音球继续，下方显示麦克风、结束和扬声器按钮。点击语音球还原主窗口。关闭麦克风会丢弃未说完的片段；关闭扬声器仍保留文字回复。纯浏览器客户端在页面隐藏时停止录音。切换 Session、断开连接和禁用插件也会停止录音。原生控件窗口失败时，会还原主窗口并结束语音模式。

自动选择在内存低于 32 GB 时使用 MLX 4-bit，在 32 GB 及以上使用 MLX 8-bit。模型文件分别约 3.0 GB 和 4.6 GB，另需托管 Python 运行时、依赖与识别模型。显式设置 `model: mlx-8bit` 至少需要 24 GB 内存。不支持的硬件会在下载前得到提示；插件不会切换到云端服务。[Breeze 模型许可](https://huggingface.co/BreezeBlue/Breeze-TTS-2/blob/main/LICENSE)将权重和自行部署的生成结果限制为研究及非商业用途。

Bundle 在 Harness 主目录下提供绝对路径 `dataRoot`。`modelOrigin` 接受兼容 Hugging Face 的来源，例如 `https://hf-mirror.com`。`voice` 选择浏览器的初始音色偏好；`instruction` 设计自然音色并指导播报，`voiceInstructions` 设计命名音色。首次使用时，模型根据 `referenceText` 生成受 `referenceMaxSeconds` 限制的参考音频，`voiceDesignCfgScale` 控制设计引导强度。参考音频保存在本地，在不同句子和工作进程重启后复用，不包含麦克风录音。`cfgScale` 控制播报引导强度。`speechThreshold`、`minimumSpeechMs`、`silenceMs` 和 `preRollMs` 控制说话检测；`maxUtteranceSeconds` 限制单次录音。`idleTimeoutMs` 默认在闲置五分钟后释放模型内存；零表示保持加载。模型和运行时文件保留在缓存中。准备与推理分别具有可取消的时限。开始对话时会静音预热语音模型；将 `warmupText` 设为空可禁用预热。`streamingIntervalSeconds` 控制 Breeze 每块生成的语音长度，默认为 0.48 秒。收到 `playbackBufferMs` 对应时长的音频、收到首块音频后等待达到该时长，或短回复完整生成时，开始播报。缓冲耗尽后，收到下一块音频就继续播放。音频输出挂起时会在播放前恢复，`playbackResumeTimeoutMs` 限制等待时间，输出不可用会显示播放失败。来源支持 HTTP 字节范围时，`downloadConnections` 和 `downloadChunkBytes` 限制并行下载。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

浏览器拥有一组启用回声消除的 AudioWorklet 录音和 Web Audio 播放生命周期。基于采样时钟的检测保留有界的起始音频并抑制短噪声。识别复用现有语音 Remote；正常 Session 提交记录识别后的文字。Chat 发布的快照仅将可见助手文字传给按轮次和步骤定位、单调前进的句子游标，因此不会朗读历史、重复快照、思考过程或工具调用。语音打断或引导消息后，同一轮中的新助手步骤仍可播报。尚未合成的短句合并为有界片段，合成与播放重叠，最多提前一个完整片段；队列满时保留剩余文字，等播放释放空间后继续。思考与实际播报分别显示状态，也适用于文字消息的回复。无法确认发送结果的识别文字会保留，供手动插入；插件不会自动重试发送。

Host 在接受模型缓存前校验固定文件大小与 SHA-256。显式准备安装固定版本 uv、独立 Python 和 MLX Audio，不修改系统 Python。一组带认证的本机回环工作进程生成单声道 24 kHz PCM16；取消或失败的推理会等待工作进程终止，再允许后续合成。HTTP 分块结束标记区分完整响应和截断音频流；达到 token 上限时也会将部分播报报告为失败。下载以原子方式发布，已验证完成的文件在重试时保留。随包配置不增加模型工具或智能体循环分支。

主渲染进程拥有音频与 Session 保留句柄。桌面悬浮窗通过校验来源的 IPC 接收带修订号的阶段、静音状态和语音球反馈。反馈包含麦克风音量和已接收的语音消息数量。悬浮窗不创建另一个录音器或 Host。桌面壳只在该音频生命周期内关闭后台限流，释放后恢复之前的值。见[桌面语音所有权决策](../../../.agents/notes/implemented/architecture/2026-11-16-desktop-voice-controls.zh.md)。

Python 脚本与固定依赖清单先复制到用户缓存中的仅当前用户可读文件，再交给外部程序使用。按内容标识的目录支持 Electron 归档安装包，无需修改已安装应用。准备失败会显示具体阶段与恢复建议；重试复用现有独立 Python 和已校验模型文件。

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
- 本包不提供使用用户录音的声音克隆、唤醒词、识别过程中的实时字幕，以及思考过程或代码块的语音合成。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
