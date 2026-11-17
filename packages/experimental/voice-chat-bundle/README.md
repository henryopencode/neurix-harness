---
description: "Enable local realtime voice conversations independently of dictation."
kind: "package-bundle"
---

# @deepseek-ai/dsh-voice-chat-bundle

English | [中文](README.zh.md)

## Summary

Enable Voice chat in Plugins for continuous local conversations with SenseVoice and Breeze TTS 2. The separate Voice input switch controls dictation. Both features share recognition resources; neither starts model downloads until explicit preparation.

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

Open Plugins and enable **Voice chat**. Open its plugin details to choose input and recognition settings, then use **Download and prepare**. The empty composer shows the voice waveform; typing restores Send. Desktop minimization keeps voice controls in a compact native window. Switching off this bundle ends recording and playback while leaving ordinary dictation available when Voice input is enabled. Apple Silicon Macs with at least 12 GB of memory can prepare local Breeze weights; unsupported Hosts show the hardware requirement before downloading.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The patch composes the shared speech service, local SenseVoice provider, browser transcription API and voice conversation plugin. Matching speech rows retain the same ids and configuration as the dictation bundle, so enabling both creates one recognizer and one API namespace. Synthesis owns its separate cache under the Harness home. The [voice chat package](../voice-chat/README.md) owns runtime preparation and playback.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Voice input subsystem](../../../docs/subsystems/voice-input.md)

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the voice chat consumer, which submits recognized utterances as ordinary user messages.

#### KV Cache effect

No direct effect; ordinary submission owns the message content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Local Breeze currently supports Apple Silicon only. The [voice chat limitations](../voice-chat/README.md#known-limitations-and-deferred-work) describe supported memory, licensing and turn detection.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
