---
description: "Configure model-group chats with a chosen leader, direct model mentions, and shared tasks in a dsh Web profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-model-group

English | [中文](README.zh.md)

## Summary

Use a model group to let a chosen leader assign work to configured models and collect their results in one conversation. You can address a model directly with `@`, run independent model tasks together, inspect shared tasks, and stop one member or the current round. New chats default to model-group mode while this optional plugin is enabled; each chat can select single-model mode, and plugin details control the default for subsequent chats. Members share the conversation's workspace and files.

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

Enable **Model groups** on the Plugins page. In its details, choose models from the existing model catalog, select one leader, optionally describe each model's strengths, and save. Provider connections and credentials stay in the ordinary model settings. Configured models have no fixed roles.

The conversation's mode control affects only that conversation. Plugin details set `defaultMode` for new chats, `members` and `leader` for their group, and `maxParallel` for simultaneous worker models; the leader does not consume a worker slot. Unused chats follow saved member, leader, and strength changes, including a blank chat already open in the editor. Chats with accepted input or execution retain their captured members and leader. An empty group allows the current model to answer and asks you to configure members.

Send an ordinary task to let the leader choose members. Explicit natural-language model preferences guide the leader. Select a model from the `@` menu for direct delivery; references can occur within the message. Multiple model mentions deliver to the selected models independently. A partial delivery reports confirmed and failed or unconfirmed members; inspect their execution records before retrying. File and image attachments use the existing command admission path.

The member strip shows execution activity and provides direct-message and stop actions. The shared task board retains task status and ownership separately from activity. The leader can create dependencies and file-write hints through `model_group_tasks`, then start a ready task with `model_group_assign`. Successful activation settlement completes its owned tasks; unsuccessful settlement releases them and reports the outcome. File-write hints do not lock files.

Stopping the round closes assignment admission, cancels the leader, and drains its Team children. A later human message can start another round. A direct message to a busy model reaches its next step without changing the ownership of its existing assignment. Stopping one member blocks automatic reassignment until the next human request.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle composes the existing [Team service](../agent-team/README.md), the [Host runtime](../model-group-runtime/README.md), and the [Client interface](../client-ui-model-group/README.md). Team owns roster and task state; the runtime owns model routing and execution control; the Client contributes the group timeline, mentions, and plugin settings. All members use the existing workspace and file services.

The Team service uses the shared `agent-team` entry id, including when Agent Teams and Model groups are both selected. The last selected bundle supplies its initial service configuration; profile overrides target `agent-team`. Deselecting either bundle retains the service while the other still declares it.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Agent Teams](../agent-team/README.md) — durable roster, shared tasks, and peer delivery.
- [Subagents](../../subagent/subagent/README.md) — execution capacity, continuation, and cleanup.
- [Input triggers](../../client/ui-input-trigger/README.md) — model mentions alongside file and Session references.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [runtime’s model policy and tools](../model-group-runtime/README.md#model-experience) and the [Client’s recipient selection](../client-ui-model-group/README.md#model-experience). The bundle adds no separate model input.

#### KV Cache effect

No direct effect; each selected model retains the runtime’s documented history and cache behavior.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Members execute in one process and shared workspace. Concurrent writes to the same files need coordination.
- Member text enters the group timeline after each assistant message settles; the leader retains ordinary live streaming.
- Failed Team provisioning permanently reserves its member name. Use a new group conversation when initial member creation fails.
- Unloading this bundle stops its executions. It does not provide distributed execution or automatic replay of operations with external effects.

<a id="dev-note"></a>
### Dev Note

None.
