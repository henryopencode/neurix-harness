# Todo

English | [中文](todo.zh.md)

The durable todo vocabulary owned by [`@deepseek-ai/dsh-tool-todo`](../../packages/todo/tool-todo/README.md). The model-facing tool replaces one agent session's whole list; the package also owns the event declaration and replay projection. Tool behavior and configuration are on the [package README](../../packages/todo/tool-todo/README.md).

Source: [`packages/todo/tool-todo/src/types.ts`](../../packages/todo/tool-todo/src/types.ts)

## `TodoItem` — one list entry

```ts type-equiv
/**
 * One entry in an agent's todo list — the unit of the `todo/write`
 * whole-list snapshot declared by this package.
 *
 * Content and status support compact checklists. Optional planning fields
 * describe explicit dependencies, execution ownership, and deliverables;
 * omitted dependencies never imply an ordering between list entries.
 */
interface TodoItem {
  /** What this task is — a short imperative line shown in the UI. */
  content: string
  /** Lifecycle state. `in_progress` marks a task being worked now; parallel work may mark several. */
  status: 'pending' | 'in_progress' | 'completed'
  /** Stable task identity, preserved when its title or status changes. */
  id?: TodoId
  /** Display grouping only; phases impose no execution order. */
  phase?: string
  /** Work to perform and relevant input materials. */
  description?: string
  /** Observable deliverable or acceptance criterion for this task. */
  expectedOutput?: string
  /** Identities of tasks whose results this task needs. */
  dependsOn?: TodoId[]
  /** Reason a pending task cannot proceed, including a requested human decision. */
  blockedReason?: string
  /** Published child Session performing this task; execution events remain authoritative. */
  sessionId?: SessionId
  /** Concise recorded result or verification evidence. */
  result?: string
  /** Output file paths, resolved relative to the owning Session's working directory. */
  artifacts?: string[]
}
```

## Durable event

The package declaration-merges `todo/write: { todos: TodoItem[]; turn?: number }` into `SessionEventMap`. The complete replacement list is log-only; an observed owning turn identifies one evolving plan. Historical records without `turn` remain readable. The generated [persistence catalog](../persistence-catalog.md#todowrite--log-only) records its declaration site.
