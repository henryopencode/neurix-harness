# Agent Note: Task plans and workflow execution evidence

Status: implemented

English | [中文](2026-11-08-task-plans-and-workflow-canvas.zh.md)

## Problem

Workflow member events describe children that have already started. They cannot identify work that remains planned, prerequisites between tasks, or work performed by the main agent. A canvas assembled from member start order would imply dependencies that execution has never declared.

## Decision

The existing todo owner records optional stable task ids, stages, explicit prerequisites, completion criteria, child Session references, and results with each whole-list replacement. The owning turn identifies one evolving plan. The private projection tracks that turn and serves the existing list view; historical records without turn identity remain readable.

Planned work and execution membership remain distinct. A task need not own a child, and a child reference does not assert success. Recorded workflow member outcomes determine the displayed execution state of explicitly linked tasks. New plan updates supersede earlier member outcomes, and historical runs retain their own states. Unlinked tasks retain their declared plan state. Stage names impose no scheduling order, and prerequisite validation does not schedule execution.

The canvas owns its Conversation Definitions and target. It does not read Chat nodes or scan the Session event window. Whole checkpoints support partial history; stable ids preserve task identity, and plan replay retains removed steps. The inspector registers in the existing sidebar. Viewing preferences remain Session-scoped and do not enter the durable log.

## Alternatives considered

- A separate planning tool would divide the agent's task list between two owners and require duplicate updates.
- One node per agent would omit main-agent work and steps that have not started.
- Ordering edges inferred from phases or timestamps would state prerequisites without evidence.
- A new execution scheduler would change cancellation, retry, and side-effect guarantees merely to expose current work.

## Consequences

Existing compact lists remain valid, while detailed plans carry more argument tokens. Each update must preserve ids and relevant metadata. Execution evidence currently covers recorded workflow members; ordinary task status alone remains a plan declaration. Node-level retry and plan editing require their own execution semantics.

[Tool-guidance ownership](2026-07-05-prompt-variables-and-tool-guidance-ownership.md) remains authoritative for model instructions. [Projection-owned client state](2026-08-25-session-observations-and-projection-owned-client-state.md) remains authoritative for recovery ownership. Replay tests compare full replacement, live append, and historical prepend; browser acceptance exercises the shipped tool, graph, inspector, narrow layout, and reload.
