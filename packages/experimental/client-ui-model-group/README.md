---
description: "Model-group settings, conversation mode, direct model mentions, and attributed member posts in the Web client."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-model-group

English | [中文](README.zh.md)

## Summary

Choose models and a leader from plugin details, change an individual conversation between single-model and model-group modes, and address models with `@`. The group shows model activity, public replies, and stop controls. Enable the [Model groups bundle](../model-group/README.md) to load the runtime and this interface together.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The bundle owns the Plugins-page entry. Its details page stages member selection, strengths, leader, parallelism, and the default mode until Save. Saved models absent from the current catalog remain editable and removable. A catalog failure preserves the last usable result and offers Retry.

Each conversation reads its captured group configuration through shared Session projections. Member buttons insert exact aliases; the input-trigger source resolves model mentions without replacing file or Session references. Direct messages use authenticated commands, while ordinary messages retain the resident composer. Partial delivery and stop failures remain visible. Group posts stay outside collapsed tool details.

Model controls occupy a single row above the input card, scrolling horizontally in narrow windows. Idle models show their names and leader badge; execution adds activity and member stop icons with tooltips. The composer's Stop cancels the whole group and remains available when only members are running. Stop failures remain visible beside the member or in the composer.

Member replies use bordered message blocks with full model names. In group mode, the resident Assistant's replies show the leader's name and badge. Task operations show localized action and target summaries; raw input and results remain expandable. Historical assignment posts collapse as task instructions, and model failures retain the affected model's name and a retry hint.

Direct messages show their accepted recipients as “Sent to”, independently of member execution. The `@` menu labels model addressing separately from quoting member and historical Session records; both actions remain available. Member detail views retain group-owned model selection and omit the root conversation's mode control.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client plugin registers localized controls through Conversation slots, a keyed Chat post renderer, an input-trigger source, and a bundle configuration component. Controls and settings support every shipped UI language. Member selection reads the same configured model catalog as the ordinary model selector, including provider, credential, and connection updates. Staged configuration belongs to an instance-owned controller. Disposal unregisters UI contributions. Existing Session, workspace, attachment, and file services retain their ownership.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Direct model messages

#### What the model sees

A model mention such as `@model-name` selects the receiving model. The [runtime](../model-group-runtime/README.md) logs the original text and admitted attachments before model execution. Ordinary messages retain their existing submission path.

#### Token effect

Each selected model receives one task input in its own history. Rendered group posts and controls add no model tokens.

#### KV Cache effect

Direct input appends after the receiving model’s persisted prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Member text appears after each assistant message settles.
- Detailed member tool execution uses the existing child-Session view.
- The group provides no separate filesystem or private message history.

<a id="dev-note"></a>
### Dev Note

None.
