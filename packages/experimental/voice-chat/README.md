---
description: "Talk to the current agent with local recognition and on-demand Breeze TTS 2 playback."
kind: "package-reference"
---

# @deepseek-ai/dsh-voice-chat

English | [中文](README.zh.md)

## Summary

Prepare local voice models on the plugin page, then start a continuous voice conversation from the empty composer. Pauses submit recognized text through normal Session admission; visible assistant answers play as speech, and speaking interrupts playback. Models download only after Download and prepare. Local Breeze currently requires an Apple Silicon Mac with at least 12 GB of memory.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Enable the [Voice chat bundle](../voice-chat-bundle/README.md), then open **Plugins → Custom plugins → Voice chat**. Select a microphone, recognition service, and language; the page shows the hardware-selected Breeze model and each service's preparation state. **Download and prepare** explicitly prepares recognition and Breeze. Opening settings does not acquire the microphone; **Check microphone** requests permission, lists inputs, and releases its check capture. Input preferences stay in this browser, independently of dictation preferences.

An empty composer shows the waveform action. Text or attachments restore Send; running-task Stop and retry actions keep their existing behavior. Click the waveform to start prepared voice capture; an unprepared service opens plugin settings. **End conversation** releases capture and playback without cancelling an already submitted text task. Microphone mute discards an unfinished utterance; speaker mute preserves synthesis and the written reply.

Desktop minimization keeps the same conversation active in a compact native window with microphone, speaker, End, and Restore controls. It contains no running-session list. A browser-only client can minimize the voice panel into a page-local floating control; it stops capture when its page is hidden. Switching Sessions, disconnecting, and disabling the plugin also stop capture. A native control-window failure restores the main window and ends voice mode.

Automatic selection uses MLX 4-bit below 32 GB and MLX 8-bit at 32 GB or more. The checkpoints occupy about 3.0 GB and 4.6 GB respectively, plus the managed Python runtime, dependencies, and recognition models. Explicit `model: mlx-8bit` requires at least 24 GB. Unsupported hardware is reported before downloading; the plugin never switches to a cloud service. [Breeze's model license](https://huggingface.co/BreezeBlue/Breeze-TTS-2/blob/main/LICENSE) limits weights and self-hosted outputs to research and non-commercial use.

The bundle supplies an absolute `dataRoot` under the Harness home. `modelOrigin` accepts a Hugging Face-compatible origin, such as `https://hf-mirror.com`. `instruction` and `cfgScale` control delivery. `speechThreshold`, `minimumSpeechMs`, `silenceMs` and `preRollMs` control turn detection; `maxUtteranceSeconds` bounds a recording. `idleTimeoutMs` releases idle model memory after five minutes by default; zero keeps it loaded. Models and runtime files remain cached. Preparation and inference have separate cancellable deadlines. Starting a conversation silently warms the voice model; an empty `warmupText` disables warmup. `downloadConnections` and `downloadChunkBytes` bound parallel transfers when the origin supports HTTP byte ranges.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The browser owns one echo-cancelled AudioWorklet capture and Web Audio playback lifetime. Sample-clock detection keeps bounded onset audio and suppresses brief noise. Recognition uses the existing speech Remote; ordinary Session submission logs the resulting text. Chat's published snapshots supply only visible assistant text to a monotonic sentence cursor, so history, repeated snapshots, reasoning, and tool calls are not read aloud. Playback and synthesis queues are bounded. A recognized message with uncertain delivery is preserved for manual insertion; the plugin never retries it automatically.

The Host checks pinned sizes and SHA-256 hashes before accepting model caches. Explicit preparation installs a release-pinned uv, private Python, and MLX Audio without changing system Python. One authenticated loopback worker produces mono 24 kHz PCM16; cancelled or failed inference joins worker termination before subsequent synthesis. HTTP chunk framing distinguishes a completed response from a truncated stream. Downloads publish atomically, and verified completed files survive retries. The shipped configuration adds no model tool or agent-loop branch.

The primary renderer owns audio and Session retention; the desktop window projects revisioned phase and mute state through origin-checked IPC. It never creates another recorder or Host. The shell disables background throttling only for that audio lifetime and restores its previous value after release. See the [desktop voice ownership decision](../../../.agents/notes/implemented/architecture/2026-11-16-desktop-voice-controls.md).

Python scripts and the pinned dependency list are materialized as owner-only files under the user cache before external executables read them. Their content-addressed directory supports packaged Electron archives without changing the installed application. Preparation reports the failing stage with recovery guidance; retries reuse the existing private Python and verified model files.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Voice input subsystem](../../../docs/subsystems/voice-input.md), [SenseVoice preparation](../speech-to-text-sensevoice/README.md), and [Breeze TTS 2](https://github.com/breezeblue-ai/breeze-tts).

-----

<a id="model-experience"></a>
## Model Experience

### Recognized utterances

#### What the model sees

Recognized speech becomes ordinary `user/message` text after automatic submission. Microphone samples, playback bytes, and preparation state remain outside model requests. The selected chat model and its tools remain unchanged.

#### Token effect

Each submitted utterance adds its recognized text as a user message; silence and unconfirmed noise add no messages.

#### KV Cache effect

Recognized messages append to Session history without rewriting earlier messages. Speech synthesis adds no model context; other plugins and the provider determine cache availability.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Local inference currently supports Apple Silicon only. Intel Macs, Windows, Linux, and lower-memory machines report unsupported; GGUF and CUDA runtimes are not installed.
- Recognition runs after each detected utterance. Turn detection uses audio level and silence, rather than semantic end-of-turn prediction. Headphones help avoid false interruptions from loudspeaker echo; actual latency depends on local hardware.
- Voice cloning, wake words, streaming partial recognition, and synthesis of reasoning or code blocks are outside this package.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
