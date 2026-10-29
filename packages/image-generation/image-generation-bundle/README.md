---
description: "Enable and configure image generation from Settings."
kind: "package-bundle"
---

# @deepseek-ai/dsh-image-generation-bundle

English | [中文](README.zh.md)

## Summary

Add image generation to Web or Desktop conversations from Settings. Configure your generation endpoint, image model, and API key, then turn on conversation image generation. This capability ships disabled and uses your provider account for each request. Generated images appear in the conversation and remain in its history.

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

Open Plugins → **Extension tools** → **Image Generation** and enable the plugin with its switch. On the detail page, enter your complete generation endpoint, image model, and API key, check **Enable image generation in conversations**, and save. The form edits custom values without provider presets or reset controls. The default aspect-ratio selector offers square, landscape, portrait, and ultrawide options; compatible Images APIs retain a default pixel-size input. Existing pixel dimensions display as their matching ratio without changing the saved value. A size or ratio explicitly requested in conversation takes precedence over the saved default. When you do not request one, generation uses that default; choose **Unspecified** or clear the size input to let the provider choose instead. Quality appears when the configured protocol supports it. Generation stays off until an enabled configuration with a model and key is saved. The card remains in Extension tools when the plugin is disabled. It reports Disabled when off and Needs setup only when the active settings are incomplete; configured or temporarily unavailable settings show no setup tag.

The API key is saved on the current Host and never returned to the browser; the form reports only whether it is configured. Leave its input blank on later saves to keep the stored key. Saving invalid values retains the drafts for correction. Configuration and activation apply live; calls already running retain their admitted settings.

Return to the conversation and ask for an image, for example: “Generate a watercolor illustration of a cat reading beside a window.” A successful call shows the images below its tool row; expand the conversation's process section to view them when it is collapsed. Clicking a preview opens the existing image viewer; reopening the conversation reloads the saved attachment.

The [tool configuration](../tool-image-generation/README.md#use-this-package) covers provider options and a private configuration template. Disabling this bundle removes the tool from subsequent requests.

-----

<a id="understand-the-implementation"></a>

## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

[`cordis.patch.yml`](cordis.patch.yml) inserts `tool-image-generation` with generation disabled. Web and Desktop load the browser configuration entry independently, so `plugins.bundle.config` remains registered while the runtime bundle is off. The tool's volatile Config fields remain editable while generation is disabled. One revision-fenced mutation saves all staged fields. Activation uses the plugin manager's bundle switch. Existing tool and attachment views display saved results.
</details>

-----

<a id="further-exploration"></a>

## Further Exploration

- [Image generation packages](../README.md) — the capability map.
- [Image-generation tool](../tool-image-generation/README.md) — provider settings and failures.
- [Profile composition](../../boot/app-boot/README.md) — optional layer loading.

-----

<a id="model-experience"></a>

## Model Experience

Indirectly, through the [image-generation tool](../tool-image-generation/README.md), which owns the schema and result content.

#### KV Cache effect

The tool owns request-prefix effects when its visibility changes and append-only result history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Provider credentials and a model are required before enabling the tool; selecting the bundle alone leaves generation disabled.
- This bundle provides text-to-image generation. Image editing and provider-specific request fields need additional support.

-----

<a id="dev-note"></a>

### Dev Note

<details>
<summary>Maintainer context — click to expand</summary>

None.

</details>
