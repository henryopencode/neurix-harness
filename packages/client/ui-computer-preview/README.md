---
description: "Shared display-only previews for independently enabled browser and application control."
kind: package-reference
---

# @deepseek-ai/dsh-client-ui-computer-preview

English | [中文](README.zh.md)

## Summary

Watch browser and application activity in independently movable and resizable picture-in-picture panels. The Web profile mounts the shared renderer automatically. It starts no operating runtime and provides no model tool.

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

Enable Browser control or Application control from Plugins. The Web profile includes this carrier; users do not enable it separately. The Client provides `computerPreviewUi`, and each source registers a capture callback with its own lifetime and source identity. The Host body has no settings, tools, or capture side effects.

Previews appear automatically when a target is available. Drag the picture to move it within the application window, or drag either bottom corner to resize it. Maximize fills the available window while preserving the image proportions; Restore returns to the previous floating size and position. Collapse pauses capture and leaves an Expand button.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

The Host exports a capture registry that each control plugin mounts with its own Remote and live pacing settings. The injected Client service mounts portals through the Session-scoped header slot without adding header controls. Each panel keeps its own display state and cancels pending reads when collapsed or unloaded. Shared geometry preserves the image proportions and clamps it to the viewport with desktop titlebar clearance. Capture ownership and Remote authentication remain with the source plugin.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Browser control](../../experimental/browser-control/README.md) — hidden browser source.
- [Application control](../../experimental/computer-control/README.md) — native foreground source.

-----

<a id="model-experience"></a>
## Model Experience

None, as display-only preview images and controls never enter model requests or Session logs.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Sources own capture failures, permissions, and refresh pacing.
- Panels are display-only; operating input uses the owning control tool.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context — click to expand</summary>

None.

</details>
