---
description: "Operate web pages in an independent hidden browser with picture-in-picture."
kind: package-bundle
---

# @deepseek-ai/dsh-experimental-browser-control

English | [中文](README.zh.md)

## Summary

Complete web tasks in an independent hidden browser on Windows, macOS, and Linux, and watch it in picture-in-picture. Enable and configure this optional plugin from Plugins. It keeps regular browser tabs and sign-ins separate. Foreground application control belongs to its own plugin.

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

Open **Plugins → Extension tools → Browser control** and enable it. Select an installed Chrome, Chromium, or Edge distribution; Chrome is the default. The browser always runs hidden in an independent session without importing regular tabs, cookies, or sign-ins. Session isolation is not an operating-system security sandbox.

The `browser` tool operates only its owned tabs. Application control can run alongside it with its own `application` tool, approval, and preview. Browser control never invokes native application input. Disabling the plugin or calling `reset` closes its Session-owned browser.

**Ask before each browser action** defaults off and applies immediately to all conversations after saving. `list` and `observe` remain automatic; every other action needs one-shot approval. An unavailable approval channel blocks actions. Enable **Include screenshots** only for image-capable models; picture-in-picture stays available independently. Other runtime settings need a new conversation. Advanced settings contain action and startup/navigation timeouts.

Hidden pages use a 1440×900 CSS-pixel viewport. Configure `browserViewportWidth` and `browserViewportHeight` under `browser-control` to change it. Picture-in-picture fits the complete current viewport; scroll for content outside it. Drag the image to move it, or drag either bottom corner or use arrow keys to resize with its proportions preserved. Closing or collapsing stops preview capture while the Agent continues. Preview images are not sent to the model or written to Sessions.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

The [patch](cordis.patch.yml) inserts an isolated browser-use registry and mounts the [unified runtime](../computer-use-unified/README.md) with the browser operation set. The executor rejects native actions before approval or resource acquisition. Each Agent owns its browser and preview pool. The Client reuses the injected preview renderer while application activation remains independent.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Computer-control guide](../../../docs/user/guide/computer-control.md) — conversation tests and recovery.
- [Application control](../computer-control/README.md) — macOS foreground input.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [unified provider](../computer-use-unified/README.md), which owns the browser tool, guidance, and results.

#### KV Cache effect

Activation changes the tool and guidance prefix; results append to history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The selected browser must already be installed; this plugin does not install software.
- Regular browser windows and sign-ins require the separate application-control plugin.
- Independent browser sessions do not provide OS process or network confinement.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context — click to expand</summary>

None.

</details>
