---
description: "Choose and configure image generation for conversations."
kind: "package-group"
---

# image-generation/ — images from conversation prompts

English | [中文](README.zh.md)

## Summary

Generate images from text in a conversation and keep the results available in its history. Choose an OpenAI-compatible Images API or MiniMax and configure its endpoint, model, and API key. Plugins → Extension tools → Image Generation exposes this setup; the optional tool saves images through the existing attachment store. Generation uses your configured provider and may incur its charges.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>

## Packages

Choose the bundle for the GUI or mount the tool in a custom composition.

| Package | Role |
|---|---|
| [`image-generation-bundle/`](image-generation-bundle/README.md) | Image-generation setup in Settings and optional runtime activation |
| [`tool-image-generation/`](tool-image-generation/README.md) | Generates images and returns saved attachments |

-----

<a id="related-documentation"></a>

## Related documentation

- [Attachment subsystem](../../docs/subsystems/attachment.md) — durable storage and authorized image access.
- [Profile composition](../boot/app-boot/README.md) — composing optional capabilities.

<a id="dev-note"></a>

## Dev Note

None.
