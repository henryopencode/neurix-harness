# Agent Teams

English | [中文](agent-team.zh.md)

Types shared by the shared task board, model tools, and host adapters. The [task-board wait decision](../../.agents/notes/implemented/architecture/2026-10-19-team-task-board-inbox.md) owns coordination semantics; this page records durable and client-visible forms from [`packages/team/agent-team/src/types.ts`](../../packages/team/agent-team/src/types.ts).

## Identity and historical roster

`TeamId` brands the root `SessionId`; `TeamTaskId` uses `task-<n>`. `TeamMessageId` and roster records remain for historical decoding. The subagent runtime resolves the tree and discovers eligible task owners at arbitrary depth; historical roster entries grant no authority.

```ts type-equiv
/** Historical roster value written by earlier Team builds on every teammate lifecycle change. */
interface TeamMemberSnapshot {
  /** Coordination namespace retained by historical named-teammate records. */
  readonly coordinationOwner?: string
  readonly id: SessionId
  readonly name: string
  readonly description: string
  readonly provider: string
  readonly context: 'fresh' | 'fork'
  readonly phase: TeamMemberPhase
  readonly error?: string
}
```

Historical records retain their recorded `provisioning`, `active`, or `failed` phase. Current turn activity belongs to ordinary subagent discovery and Session status, independently of task completion.

## Messages and historical mailbox

Members exchange ordinary [subagent messages](subagent.md), retaining the real sender Session id. Task changes do not end inbox waits, add inbox messages, or start idle agents. Send an explicit message when an agent needs to act on a task update. The following historical mailbox types remain readable; Team never delivers their pending records.

```ts type-equiv
/** One peer message recorded by the historical Team mailbox. */
interface TeamMessageSnapshot {
  readonly id: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  readonly targetId: SessionId
  readonly content: ContentBlock[]
}
```

Historical `team-message` sources retain the old message id and sender attribution; the client uses them for the message title and icon.

```ts type-equiv
/** Source recorded by a target Session for one historical Team mailbox delivery. */
interface TeamMessageSource {
  readonly kind: 'team-message'
  readonly teamId: TeamId
  readonly messageId: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
}
```

## Shared task DAG

Every task event stores a complete snapshot. `revision` is the compare-and-set value and increments by one per mutation. `blockedBy` edges must name non-deleted tasks and keep the graph acyclic. `writeScopes` are normalized advisory path prefixes rather than locks.

```ts type-equiv
/** Whole durable task snapshot; every mutation increments {@link revision}. */
interface TeamTaskSnapshot {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly ownerId?: SessionId
  /** Immutable agent path captured at assignment; absent on unnamed historical owners. */
  readonly ownerName?: string
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
}
```

`pending` is unstarted or released, `in_progress` carries an owner, `completed` satisfies blockers, and `deleted` is a retained tombstone. Views expose `ownerId`, readiness, and advisory write-scope overlap without changing the durable snapshot.

<a id="web-projection"></a>

## Web projection

`agentTeam.enabled` exposes the root Session’s saved selection. New Sessions default to false; `team/mode` records explicit selections. Historical tasks imply enabled until an explicit selection. Only the root can call `setEnabled`; descendants share that mode. The Web menu calls the same method through `remote.agentTeams.setEnabled`, with the root Session id resolved to its live Agent by the Gateway. Mode writes take effect before awaiting persistence. Tools resolve availability at step preparation; prompt providers read the selection when evaluated. Task mutations check the current mode when their queued operation starts; admitted mutations may finish. Mode changes do not end inbox waits. A failed flush leaves the appended selection active; retrying the same selection flushes it without a duplicate event.

The root Session publishes non-deleted task views through `SessionProjectionMap.agentTeam`. `failure` reports a rejected persisted task or mode record beside the last valid state. Historical roster and mailbox records are not projected. Views identify every owner by its Session id; the task panel and task tools display the owner's agent name, or the Session id when the owner has no name.

```ts type-equiv
/** Runtime-enriched task view returned to tools and hosts. */
interface TeamTaskView {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
  readonly ownerId?: SessionId
  /** Immutable agent path captured at assignment; absent on unnamed historical owners. */
  readonly ownerName?: string
  readonly ready: boolean
  readonly writeScopeWarnings: string[]
}
```

```ts type-equiv
/**
 * Durable Team state published to browser clients through the Lead Session's
 * `agentTeam` projection. `failure` names the first rejected persisted Team
 * record; tasks then stay at the last valid state.
 */
interface TeamProjection {
  readonly enabled: boolean
  readonly tasks: TeamTaskView[]
  readonly failure?: string
}
```

## Replay

The `agentTeam` projection replays task records selected by `TeamId` and the Session’s own mode selections. Subagent discovery owns current tree membership and ignores inherited catalog authority. Session event `seq` and `time` own ordering and timing. Committed durable generations are preserved. The [package README](../../packages/team/agent-team/README.md) defines task operations and limits.

<a id="model-groups"></a>

## Model assignment

Teammates created through the Team tools inherit the Lead's model. Trusted coordinators can pass `agentOptions` to `spawnTeammate`; the [model-group runtime](../../packages/experimental/model-group-runtime/README.md) uses it to select explicit routes. `TeamModel`, `TeamModelSelection`, and `TeamPost` retain candidate-model choices and attributed replies in existing Session events.

### Historical model-group records

Historical model-group records remain readable through their original event discriminators. They do not add a collaboration mode to the Team workflow.

| Type | Meaning |
|---|---|
| `ModelGroupMode` | `single` or `multi` for one conversation. |
| `ModelGroupMember` | A unique mention alias, display label, exact provider/model route, and user-authored strengths. |
| `ModelGroupSnapshot` | Captured mode, leader, members, stop state, and members whose latest activation serves a direct human message. |
| `ModelGroupDispatchReceipt` | Accepted member name, target Session id, and optional shared task id; settlement notices use that Session id. |
| `ModelGroupDelivery` | Public direct-message sequence, accepted execution receipts, and failed or unconfirmed recipients; acceptance does not assert completion. |
| `ModelGroupPost` | Public member text or failure, attributed to its source Session and optional assistant-message sequence. |

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxagentteams--teamservice"></a>

### `ctx.agentTeams` — `TeamService`

Agent Teams service backed by the exact live Lead Session log.

```ts cordis-catalog
/**
 * Read the Team selection shared by the caller's subagent tree.
 * @param caller - exact live root or descendant.
 * @returns whether Team tools and guidance are enabled.
 */
isEnabled(caller: Agent): boolean

/**
 * Save a root Session's Team selection without stopping children or deleting tasks.
 * The selection takes effect before awaiting persistence. Tools resolve availability at
 * step preparation; prompt providers read the selection when evaluated. Task mutations
 * check the current mode when their queued operation starts; admitted operations finish.
 * @param agent - exact live root whose tree receives the selection.
 * @param enabled - selected Team mode.
 * @param signal - cancellation checked before changing the selection.
 * @returns fulfillment after the selection flushes.
 * @throws when called by a descendant or persistence fails. An appended selection remains active;
 * retrying the same selection flushes without a duplicate event.
 */
@Remote async setEnabled(agent: Agent, enabled: boolean, signal?: AbortSignal): Promise<void>

/**
 * Create one unowned pending task in the Team Lead log.
 * @param caller - exact live Team member creating the task.
 * @param request - task text, blockers, and advisory write scopes.
 * @param signal - cancellation before the task event is appended; omitted means no cancellation.
 * @returns the revision-one task view.
 * @throws TEAM_TASK_PERSISTENCE_UNCONFIRMED when the task is visible but durability is unknown; read it before retrying.
 */
async createTask(caller: Agent, request: CreateTeamTaskRequest, signal?: AbortSignal): Promise<TeamTaskView>

/**
 * Return one task, including a deleted tombstone.
 * @param caller - exact live Team member reading the task.
 * @param id - Team-local task identity.
 * @returns the latest task value and derived readiness diagnostics.
 */
getTask(caller: Agent, id: TeamTaskId): TeamTaskView

/**
 * List current non-deleted tasks in numeric creation order.
 * @param caller - exact live Team member reading the board.
 * @returns detached current task views.
 */
listTasks(caller: Agent): TeamTaskView[]

/**
 * Compare-and-set one authorized task transition.
 * @param caller - exact live Team member authorizing the mutation.
 * @param request - task identity, expected revision, action, and action fields.
 * @param signal - cancellation before the task event is appended; omitted means no cancellation.
 * @returns the committed next task revision.
 * @throws TEAM_TASK_PERSISTENCE_UNCONFIRMED when the task is visible but durability is unknown; read it before retrying.
 */
async updateTask(caller: Agent, request: UpdateTeamTaskRequest, signal?: AbortSignal): Promise<TeamTaskView>
```

Types: [Agent](core.md)

Source: [`packages/team/agent-team/src/index.ts`](../../packages/team/agent-team/src/index.ts)

<a id="ctxlegacyagentteams--teamservice"></a>

### `ctx.legacyAgentTeams` — `TeamService`

Agent Teams service backed by the exact live Lead Session log.

```ts cordis-catalog
/**
 * Resolve one exact live Agent's Team role.
 * @param agent - exact live Agent used as the authority credential.
 * @returns its root, Team identity, role, and model-facing name.
 */
membership(agent: Agent): TeamMembership

/**
 * List the runtime-enriched roster visible to one Team member.
 * @param agent - exact live Team member.
 * @returns Lead and teammate rows in creation order.
 */
listMembers(agent: Agent): TeamMemberView[]

/**
 * Create one named, continuable direct child of the Team Lead.
 * @param caller - exact live Lead Agent.
 * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
 * @returns the active roster row.
 */
async spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult>

/**
 * Steer one peer message into the target inbox or reject the attempt.
 * @param caller - exact live sending Team member.
 * @param request - target name, content, and cancellation before acceptance.
 * @returns accepted inbox identity; acceptance follows normal Agent persistence and does not await model processing.
 */
async sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult>

/**
 * Create one unowned pending task in the Team Lead log.
 * @param caller - exact live Team member creating the task.
 * @param request - task text, blockers, and advisory write scopes.
 * @returns the revision-one task view.
 */
async createTask(caller: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView>

/**
 * Return one task, including a deleted tombstone.
 * @param caller - exact live Team member reading the task.
 * @param id - Team-local task identity.
 * @returns the latest task value and derived readiness diagnostics.
 */
getTask(caller: Agent, id: TeamTaskId): TeamTaskView

/**
 * List current non-deleted tasks in numeric creation order.
 * @param caller - exact live Team member reading the board.
 * @returns detached current task views.
 */
listTasks(caller: Agent): TeamTaskView[]

/**
 * Compare-and-set one authorized task transition.
 * @param caller - exact live Team member authorizing the mutation.
 * @param request - task identity, expected revision, action, and action fields.
 * @returns the committed next task revision.
 */
async updateTask(caller: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView>

/**
 * Wait for the next Team-domain or member-status change.
 * @param caller - exact live Team member waiting for activity.
 * @param timeoutMs - bounded wait duration from ten seconds through one hour.
 * @param signal - caller cancellation for the wait only.
 * @returns one observed change or a timeout result.
 */
async waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult>

/**
 * Interrupt one live teammate turn without clearing its pending inbox.
 * @param caller - exact live Lead Agent.
 * @param targetName - durable teammate name.
 * @returns the target status sampled before cancellation.
 */
interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'inactive' }

/**
 * Resolve a caller without throwing, used by scoped-tool installation and observers.
 * @param agent - candidate exact live Agent.
 * @returns Team membership, or undefined for non-Team subagents and stale identities.
 */
tryMembership(agent: Agent): TeamMembership | undefined
```

Types: [Agent](core.md)

Source: [`packages/experimental/agent-team/src/index.ts`](../../packages/experimental/agent-team/src/index.ts)

<a id="ctxmodelgroups--modelgroups"></a>

### `ctx.modelGroups` — `ModelGroups`

Model groups with independent model routes, shared tasks, and direct human addressing.

```ts cordis-catalog
/**
 * Read one conversation's durable model-group selection.
 * @param agent - Exact live root.
 * @returns Its group selection, if configured.
 */
snapshot(agent: Agent): ModelGroupSnapshot | null

/**
 * Change only this conversation after stopping existing executions.
 * @param agent - Live root.
 * @param mode - Desired mode.
 */
async setMode(agent: Agent, mode: ModelGroupMode): Promise<void>

/**
 * Stop current work and close new assignment admission.
 * @param agent - Live root.
 * @param member - Optional single model name.
 */
async stop(agent: Agent, member?: string): Promise<void>

/**
 * Dispatch one admitted model task.
 * @param agent - Live leader.
 * @param name - Configured model name.
 * @param prompt - Logged task input.
 * @param direct - Human-directed delivery.
 * @param signal - Admission cancellation.
 * @param taskId - Existing ready task; omission creates a new task.
 * @returns Accepted model, target Session, and shared task identities.
 */
assign( agent: Agent, name: string, prompt: ContentBlock[], direct: boolean, signal: AbortSignal, taskId?: TeamTaskId, ): Promise<ModelGroupDispatchReceipt>
```

Types: [Agent](core.md) · [ContentBlock](llm-streaming.md)

Source: [`packages/experimental/model-group-runtime/src/index.ts`](../../packages/experimental/model-group-runtime/src/index.ts)
<!-- END GENERATED cordis-surface -->
