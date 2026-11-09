---
description: "Durable workflow-run Conversation Node for the dsh web client: reconstructs top-level workflow runs as independent chat nodes with nested member disclosure."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workflow-run

English | [中文](README.zh.md)

## Summary

Inspect complex tasks as a live workflow canvas with planned steps, explicit prerequisites, stage folding, and task details. Multi-step plans appear in Chat automatically, and the Workflow tab also shows earlier loaded plans and recorded workflow runs. Task details open in the existing right sidebar with completion criteria, results, and deliverable links. Recorded child execution outcomes update explicitly linked tasks. The compact run disclosure remains available beside the canvas.

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

A top-level workflow run through `dsh-tool-workflow` appears in the conversation as its own node: expand the run to see its phases, and expand a phase to see its members. Phase groups come only from members that started, and settlement changes status without removing or reordering members.

### Task canvas

The conversation tabs are Chat, Trajectory, and Workflow. The canvas follows the newest turn and selects its more detailed plan or execution. A turn without a plan shows its recorded activity and tool outcomes; a later plan replaces that automatic view. History selection stays pinned until Follow latest task is selected. Plans and execution details from the same turn have direct navigation.

Plans may have multiple independent starts, forks, joins, and separate outputs. No task-count cap reduces the graph to summary stages. A folded phase that crosses another phase is split by dependency layer to avoid introducing a cycle. Waiting work is labelled Waiting to run, with its reason retained in the inspector.

Open the Workflow tab to pan and zoom the dependency graph, fold stages, switch to the keyboard-accessible list, or load earlier tasks. New multi-step plans have one evolving Chat preview per turn. Task ids preserve identity through renaming, and removed steps remain visible as removed from the plan. Clicking a task opens its full text, prerequisite states, completion criteria, results, and files in the existing sidebar. File links use Session-authorized document navigation.

Canvas edges come only from declared prerequisites. Stage labels impose no order, and historical workflow runs without prerequisite data remain unconnected. A linked member outcome recorded after the latest plan update takes precedence over the declared task status. New plan revisions supersede earlier outcomes, and historical runs retain their own member states. Other tasks show planned status. Active planned steps whose Turn closes after a crash or fork appear interrupted. The canvas preserves its viewport on status updates. Graph selection, display mode, and stage disclosure survive View remounts within the Session scope.

### Navigating the node

Run and phase headers keep 6px gaps between their title, count, and status fields, with the status aligned to the right. The run uses a 32-pixel row with persistent chevrons, an inline state dot, and status text; phases use disclosure rows with title and member count in the main area and a fixed aggregate-status tail; members use a 16-pixel dot slot, a truncating name area, and a fixed status column. Opening a member's child Session requires both member and child to be running, with the current Session recorded as its parent and an available child identity projection. Navigation uses the child's own mode for both continuable and historical one-shot children; external executions have no local Session to open. Child activity uses the unified UI status, falling back to the Session summary when unknown. Workflow events establish membership; missing child identity, a different parent, or a terminal member keeps the row non-interactive.

### State and completion

Completion updates the visible status immediately but delays its automatic close while focus remains inside the content. A run or member without terminal events stays running after its Turn or Step ends normally, because a background run outlives its Tool Step. It is presented as interrupted, without changing the tool result, once its Turn is closed after a crash or at a fork boundary.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The node is a deterministic replay of durable session events: `tool-workflow/run-start` creates one Context keyed by `runId`, and member starts, member endings, and the run ending update that Context in log order. A history tail containing only updates remains pending until an older page supplies the unique start, after which prepend, complete replay, and live append produce the same state.

### Disclosure choices

Ordinary running updates preserve the current choice, the first abnormal edge opens once, normal completion closes once, and a completed phase plus the outer run open again when a new running member starts under the same phase key. If an entire new clean cycle arrives in one render while the run remains active, the phase finishes folded but the outer run opens once to expose its updated summary. `WorkflowRunPanel` owns the phase choices, so closing and reopening the outer run does not reset them; a renderer remount reconstructs every initial choice from durable facts.

### Composition

The package registers run disclosures as Cordis effects. A child plugin activates the canvas, plan Definitions, View, and task inspector when the existing right-sidebar services are available. Each target owns its replay state; per-turn plan ids and complete checkpoints support live updates and paged history. Removing the plugin retracts its registrations. The shipped Web bundle includes the required sidebar services.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the tool seam, the conversation host, and the tool presentation layer.

- [tool-workflow](../../workflow/tool-workflow/README.md) — the tool that owns the four `tool-workflow/*` Session events.
- [ui-conversation](../ui-conversation/README.md) — the chat surface hosting the `conversation.chat.node` slot.
- [ui-tool](../ui-tool/README.md) — the tool-call presentation layer this node sits beside.
- [Conversation subsystem](../../../docs/subsystems/conversation.md) — how a business-owned feature registers a Conversation node.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that renders durable workflow records without changing model context.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define which runs produce records and what the node exposes; they are current package constraints.

- **Only top-level calls through `dsh-tool-workflow` produce these records** — nested PTC mode calls and direct `WorkflowEngine` consumers do not.
- **A run lost without terminal events in a normally ended Turn stays running** — for example a background run whose process crashed during a later Turn, or a run whose recording stopped after a failed append; the session log carries no fact that marks it stopped.
- **Run-disclosure navigation is live-only** — the canvas inspector can open a settled local child when its parent and descriptor are available.
- **Execution evidence is limited to recorded workflow members** — unlinked tasks retain their declared plan status. Prerequisite edges describe the plan and do not schedule execution.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
