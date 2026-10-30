---
description: "Enable macOS foreground application control from Plugins and configure defaults."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-computer-control

English | [中文](README.zh.md)

## Summary

Operate macOS applications in the foreground with visible mouse and keyboard input, including native browser windows. Enable this optional plugin from Plugins and configure its own approval, indicators, and screenshots. Picture-in-picture follows the selected application. Hidden Playwright sessions belong to the separate Browser control plugin.

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

Open Plugins → **Extension tools → Application control**. Enable the plugin to add the `application` tool. It supports macOS applications, including Chrome and Safari as native application windows. Actions activate the exact window and use the system mouse and keyboard. **Stop generating** cancels subsequent input; delivered input remains. Windows and Linux users can enable the separate [Browser control](../browser-control/README.md) plugin.

Grant Accessibility to the app that launches Harness. Screenshots and picture-in-picture also require Screen & System Audio Recording. Enable screenshots only for an image-capable model; display-only preview stays available with model screenshots disabled. Saved runtime defaults apply in a new conversation. Approval and preview pacing apply immediately.

**Ask before each application action** defaults off. When enabled, every action except `list` and `observe` needs one-shot approval. Without an available approval channel, input is blocked. Advanced settings contain the action timeout, application launch timeout, and native accessibility read budget. Pointer, scrolling, typing, and preview timing remain configurable in profile patches.

The application preview shows the selected native window and input feedback. Drag the image to move it, or either bottom corner to resize it without cropping. Focus a corner and use arrow keys to resize by keyboard. Collapsing pauses capture while the Agent continues; expanding resumes it. Capture failures retain the last image with a retry action. Preview frames are display-only and add no model input or Session events. Browser control has its own preview, approval, and resources; the plugins can run together.

Follow the [computer-control guide](../../../docs/user/guide/computer-control.md) for conversation tests and recovery.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

The [patch](cordis.patch.yml) inserts an isolated computer-use registry plus the native-only provider. The Host mounts the [unified runtime](../computer-use-unified/README.md) with the application operation set and fixed foreground input. Playwright acquisition is rejected for this runtime. Each Agent captures validated runtime defaults when its resource is acquired; approval reads the current policy for every action. The shared native queue serializes desktop calls. The browser half registers one bundle configuration slot using the existing settings form and dictionaries. It unloads with the plugin.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Unified computer runtime](../computer-use-unified/README.md) — operations, failures, and resource ownership.
- [Plugin Manager](../../boot/plugin-manager/README.md) — activation and profile persistence.
- [Computer-control guide](../../../docs/user/guide/computer-control.md) — manual tests.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [unified provider](../computer-use-unified/README.md), which owns the application tool, guidance, and results.

#### KV Cache effect

The provider owns prefix changes when activation adds or removes its tool and guidance, and append-only result history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Native application limits belong to the unified provider. The plugin operates existing browser windows through native controls and never starts Playwright.
- Approval policy and preview pacing apply immediately. Other saved runtime defaults apply to the next Agent that acquires resources.
- The detail form is available while the plugin is enabled. macOS permission grants remain an operating-system action.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context — click to expand</summary>

None.

</details>
