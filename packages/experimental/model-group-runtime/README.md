---
description: "Host orchestration for the optional model-group bundle, including per-conversation configuration, direct model delivery, and shared tasks."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-model-group-runtime

English | [中文](README.zh.md)

## Summary

Run configured models under one selected leader, share task ownership, and deliver human messages directly to a model. Each conversation retains its own model group across reloads. Use the [Model groups bundle](../model-group/README.md) for the settings and conversation controls.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The model-group bundle mounts this runtime beside the existing Team service. Its `model-group` entry owns the editable defaults described in the [bundle reference](../model-group/README.md#use-this-package). Host callers use `ctx.modelGroups`; browser controls use the authenticated human command rather than activating child Sessions directly.

Saved member, leader, and strength defaults update idle, unused conversations through recorded `model-group/configured` events. The projection recovers whether input or execution has started, so used conversations keep their routes across reloads. Conversation-local mode choices are preserved. Blank conversations also refresh when their Agent is restored.

In multi-model mode, the leader and workers retain their configured provider and model. Callers may change reasoning effort on that route; reactivating the runtime preserves the leader's selected effort. Single-model mode restores unrestricted model selection.

Assignment validates the configured member, model route, stop state, and available capacity before admitting a child. Each accepted assignment identifies its target Session and shared task. The Team service enforces ownership and revision checks. A failed or interrupted execution releases its owned task; successful settlement completes it. Partial delivery reports confirmed recipients and unconfirmed outcomes without asserting rollback.

The leader receives its exact model alias and a separate assignment roster containing only other models. It answers its own part directly; self-assignment rejects with `GROUP_SELF_ASSIGNMENT` before creating a task or public post. Assignment instructions remain tool input, while member replies become attributed public posts. An omitted or blank `task_id` creates a shared task automatically, and settlement completes it; ordinary discussion needs neither separate task creation nor member completion calls.

Worker-directed human input uses ordinary `user/message` records, preserving conversation activity and title discovery without requesting a leader response. Direct human messages record and flush `model-group/dispatched`, linking their public input sequence to accepted member/task receipts and unconfirmed recipients. Its optional `publicMessage` marker distinguishes ordinary input from legacy public posts. Acceptance reports delivery only; each member's execution retains its own running and settlement state.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The runtime stores recoverable configuration in the `modelGroup` projection. It keeps model executions in continuable subagents and publishes attributed public messages in the leader log. Per-group controllers close admission during stop, cancel preflight, await pending starts, and drain accepted executions before reporting quiescence. Service disposal retains the projection reader until owned work settles. Pure replay starts no models. Projection storage and coordination updates cost O(m) for m configured models; unrelated events retain the same state in O(1). Public messages remain in paged history.

The [Team subsystem](../../../docs/subsystems/agent-team.md#model-groups) documents the public types and generated service API. Browser-safe consumers import the `./types` entry; the Host class and its service declarations stay out of Client programs.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Group task delivery

#### What the model sees

Shared system guidance reserves model assignment to the leader and requires members to complete their own work. The leader receives its identity, the other models, stop state, and editable strengths as logged runtime context, plus `model_group_assign` and `model_group_tasks`. Workers receive task input and its shared task id; their replies and settled results reach the group and leader automatically without duplicate result messages. The leader is instructed to synthesize rather than repeat complete public replies. Human-directed requests belong to the selected model; its settlement does not request an additional leader answer.

#### Token effect

Each model owns its request history. Roster context grows with the configured members; task delivery and result notices append to the receiving history. Ordinary direct input also enters the leader's logged history for later requests, without starting a leader call at delivery. Public post records alone add no model tokens.

#### KV Cache effect

Continuation reuses each model's own persisted prefix. Fresh workers receive task-specific context and do not inherit the leader's complete history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Members share one process and working directory. Write scopes are advisory.
- Public text posts settle per assistant message.
- Group restart does not replay operations with external effects; models may need to inspect partial work before resuming.

<a id="dev-note"></a>
### Dev Note

None.
