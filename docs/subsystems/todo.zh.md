# Todo

[English](todo.md) | 中文

本页记录 [`@deepseek-ai/dsh-tool-todo`](../../packages/todo/tool-todo/README.zh.md) 拥有的持久 todo 词汇。面向模型的工具会整体替换一个 agent（智能体）会话的列表；该包还拥有事件声明和回放投影。工具行为与配置见[包 README](../../packages/todo/tool-todo/README.zh.md)。

源码：[`packages/todo/tool-todo/src/types.ts`](../../packages/todo/tool-todo/src/types.ts)

## `TodoItem`：一条列表项

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

## 持久事件

该包通过声明合并把 `todo/write: { todos: TodoItem[]; turn?: number }` 加入 `SessionEventMap`。完整替换列表仅写入日志；已观察到的所属轮次标识同一份持续更新的计划。不含 `turn` 的历史记录仍可读取。生成的[持久化目录](../persistence-catalog.zh.md#todowrite--log-only)记录其声明位置。
