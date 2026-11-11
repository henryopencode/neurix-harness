# Agent Teams

[English](agent-team.md) | 中文

共享任务板、模型工具和 host 适配器共享的类型。[任务板等待决策](../../.agents/notes/implemented/architecture/2026-10-19-team-task-board-inbox.zh.md)负责协调语义；本页记录 [`packages/team/agent-team/src/types.ts`](../../packages/team/agent-team/src/types.ts) 中的持久化和客户端可见形式。

## 身份与历史名册

`TeamId` 品牌化根 `SessionId`；`TeamTaskId` 使用 `task-<n>`。`TeamMessageId` 和名册记录为历史解码保留。subagent 运行时解析树，并发现任意深度的有效任务所有者；历史名册条目不授予权限。

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

历史记录保留其记录的 `provisioning`、`active` 或 `failed` 阶段。当前轮次活动属于普通 subagent 发现和 Session 状态，与任务完成相互独立。

## 消息与历史 mailbox

成员交换普通 [subagent 消息](subagent.zh.md)，保留真实发送方 Session id。任务变更不会结束收件箱等待、添加收件箱消息或启动空闲 agent。需要 agent 处理任务更新时，发送明确消息。下列历史邮箱类型保持可读；Team 绝不投递其待处理记录。

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

历史 `team-message` source 保留旧消息 id 与发送者归属；客户端用它们展示消息标题和图标。

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

## 共享任务 DAG

每条 task event 都存储完整快照。`revision` 是 compare-and-set 值，每次变更递增 1。`blockedBy` edge 必须指向未删除任务，并维持无环图。`writeScopes` 是规范化的提示性路径前缀，不是锁。

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

`pending` 表示未开始或已释放，`in_progress` 携带负责人，`completed` 满足依赖，`deleted` 是保留的墓碑记录。视图提供 `ownerId`、就绪性和写入范围重叠提示，不改变持久快照。

<a id="web-projection"></a>

## Web 投影

`agentTeam.enabled` 提供根 Session 保存的选择。新 Session 默认为 false；`team/mode` 记录显式选择。历史任务在显式选择前视为开启。仅根可调用 `setEnabled`；后代共享该模式。Web 菜单通过 `remote.agentTeams.setEnabled` 调用同一方法，Gateway 将根 Session id 解析为其存活 Agent。模式写入先立即生效，再等待刷盘。工具在步骤准备时确定可用性；提示词提供方在求值时读取选择。任务修改在排队操作开始时检查当前模式；已获准的修改可继续完成。模式变更不会结束收件箱等待。刷盘失败时已追加的选择仍然生效；重试相同选择会再次刷盘，不重复追加事件。

根 Session 通过 `SessionProjectionMap.agentTeam` 发布未删除任务视图。`failure` 在最后有效状态旁报告被拒绝的持久化任务或模式记录。历史名册与邮箱记录不参与投影。视图以 Session id 标识每个负责人；任务面板和任务工具显示负责人的 agent 名称，负责人没有名称时显示其 Session id。

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

## 回放

`agentTeam` 投影按 `TeamId` 重放任务记录，并重放 Session 自身的模式选择。subagent 发现负责当前树成员关系，不将继承目录作为权限来源。Session 事件的 `seq` 和 `time` 负责排序和时间。已提交的持久化代次保持不变。[包 README](../../packages/team/agent-team/README.zh.md)定义任务操作和限制。

<a id="model-groups"></a>

## 模型分配

通过团队工具创建的队友继承负责人的模型。可信协调器可以向 `spawnTeammate` 传入 `agentOptions`；[模型群运行时](../../packages/experimental/model-group-runtime/README.zh.md) 用它选择明确的模型路由。`TeamModel`、`TeamModelSelection` 和 `TeamPost` 保留已有 Session 事件中的候选模型选择与署名回复。

### 历史模型群记录

历史模型群记录继续通过原事件判别项读取，不会为团队流程增加协作模式。

| 类型 | 含义 |
|---|---|
| `ModelGroupMode` | 单个会话的 `single` 或 `multi` 模式。 |
| `ModelGroupMember` | 唯一的 @ 别名、显示名称、精确的 provider/model 路由及用户描述的擅长任务。 |
| `ModelGroupSnapshot` | 已记录的模式、leader、成员、停止状态，以及最近一次执行处理用户定向消息的成员。 |
| `ModelGroupDispatchReceipt` | 已接收的成员名、目标 Session id 和可选的公共任务 id；结算通知使用该 Session id。 |
| `ModelGroupDelivery` | 公开定向消息的序号、执行接收回执，以及失败或未确认的收件人；接收不代表完成。 |
| `ModelGroupPost` | 成员公开文本或失败，携带来源 Session 以及可选的 assistant 消息序号。 |

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.zh.md)

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

Types: [Agent](core.zh.md)

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

Types: [Agent](core.zh.md) · [ContentBlock](llm-streaming.zh.md)

Source: [`packages/experimental/model-group-runtime/src/index.ts`](../../packages/experimental/model-group-runtime/src/index.ts)
<!-- END GENERATED cordis-surface -->
