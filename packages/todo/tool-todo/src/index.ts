/**
 * Model-facing whole-list replacement. Each call appends a `todo/write` snapshot to the calling
 * agent's session; replay is last-write-wins, and UIs render from session events. A non-agent
 * caller has no owning list and is rejected. Named exports preserve loader injection metadata.
 * @module @deepseek-ai/dsh-tool-todo
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { TodoId, TodoItem } from './types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: resolves the required ctx.sessionProjections service declaration.
import type {} from '@deepseek-ai/dsh-session-projection'
// The `todos` projection-key declaration lives in src/types.ts (its one home);
// this re-export projects the type face onto the package root AND keeps the
// module edge in the emitted index.d.ts, so aggregate programs consuming the
// declarations still receive the SessionProjectionMap merge.
export type * from './types.ts'

export const name = 'tool-todo'
export const inject = ['tools', 'sessionProjections']

/** The valid {@link TodoItem} statuses, as a runtime set for input narrowing. */
const STATUSES = ['pending', 'in_progress', 'completed'] as const

/** Model-facing todo tool configuration. */
export interface Config {
  /**
   * Required deployment choice for whether several todos may be `in_progress` at once. True suits
   * agents that run work concurrently — subagents, background commands, workflow fan-out — and the
   * description then instructs the model to mark every actively worked task. False restores the
   * single-active discipline: the description asks for exactly one, and a call marking more is
   * rejected.
   */
  allowParallelInProgress: boolean
}

/** Schemastery configuration for the todo tool consumer. */
export const Config: z<Config> = z.object({
  allowParallelInProgress: z.boolean().required(),
})

const DESCRIPTION_HEAD =
  'Record and update a task list to plan multi-step work and show progress; skip it for trivial '
  + 'single-step tasks. Add one todo per concrete, verifiable step before you start. '
  + 'For complex work, give tasks stable ids, group them by phase, describe their inputs and expected outputs, '
  + 'and declare dependsOn only for actual prerequisites. Include planned steps before they start; '
  + 'preserve ids and all relevant fields when updating the complete list. '
  + 'Attach a published child sessionId when delegating, blockedReason when waiting, '
  + 'and result plus artifact file paths when work produces evidence or deliverables. '

const DESCRIPTION_PARALLEL =
  'While work remains, keep the todos being worked on `in_progress`, several only when work runs in parallel. '

const DESCRIPTION_SINGLE =
  'While work remains, keep exactly one todo `in_progress`. '

const DESCRIPTION_TAIL = 'Mark each todo `completed` as soon as it is done.'

/**
 * The model-facing description for one activation. The active-status clause is the only part that
 * varies, because it is the only instruction the parallel policy changes.
 * @param allowParallel - whether several todos may be `in_progress` at once.
 * @returns the composed tool description.
 */
function describe(allowParallel: boolean): string {
  return DESCRIPTION_HEAD
    + (allowParallel ? DESCRIPTION_PARALLEL : DESCRIPTION_SINGLE)
    + DESCRIPTION_TAIL
}

/**
 * Canonicalize task text and local identities while preserving paths and child references. Reject duplicate
 * labels or ids, missing prerequisites, dependency cycles, and disallowed parallel activity before
 * appending a plan. The registry and checkpoint schemas enforce field types and status literals;
 * unknown tool parameters fail validation instead of being discarded.
 * @param raw - the model-supplied list, already schema-checked.
 * @param allowParallel - whether several items may be `in_progress` at once.
 * @returns the canonical list.
 */
function toTodoList(raw: {
  content: string
  status: string
  id?: string | undefined
  phase?: string | undefined
  description?: string | undefined
  expectedOutput?: string | undefined
  dependsOn?: string[] | undefined
  blockedReason?: string | undefined
  sessionId?: string | undefined
  result?: string | undefined
  artifacts?: string[] | undefined
}[], allowParallel: boolean): TodoItem[] {
  const todos: TodoItem[] = []
  const seen = new Set<string>()
  let active = 0
  for (const item of raw) {
    const content = item.content.trim()
    if (content.length === 0) {
      throw new Error('invalid todo: `content` must be a non-empty string')
    }
    if (seen.has(content)) {
      throw new Error(`invalid todos: duplicate content ${JSON.stringify(content)}`)
    }
    seen.add(content)
    if (item.status === 'in_progress') active++
    const todo: TodoItem = { content, status: item.status as TodoItem['status'] }
    for (const key of ['phase', 'description', 'expectedOutput', 'blockedReason', 'result'] as const) {
      if (item[key] !== undefined) todo[key] = nonEmpty(item[key], key)
    }
    if (item.id !== undefined) todo.id = nonEmpty(item.id, 'id') as TodoId
    if (item.sessionId !== undefined) {
      nonEmpty(item.sessionId, 'sessionId')
      todo.sessionId = item.sessionId as SessionId
    }
    if (item.dependsOn !== undefined) {
      todo.dependsOn = item.dependsOn.map(id => nonEmpty(id, 'dependsOn') as TodoId)
    }
    if (item.artifacts !== undefined) todo.artifacts = item.artifacts.map((path) => {
      nonEmpty(path, 'artifacts')
      return path
    })
    todos.push(todo)
  }
  if (!allowParallel && active > 1) {
    throw new Error(`invalid todos: at most one task may be in_progress (got ${active})`)
  }
  validateDependencies(todos)
  return todos
}

function nonEmpty(value: string, field: string): string {
  const result = value.trim()
  if (result.length === 0) throw new Error(`invalid todo: \`${field}\` must be a non-empty string`)
  return result
}

function validateDependencies(todos: readonly TodoItem[]): void {
  const byId = new Map<TodoId, TodoItem>()
  for (const todo of todos) {
    if (todo.id === undefined) {
      if (todo.dependsOn?.length) throw new Error('invalid todo: tasks with dependsOn require an id')
      continue
    }
    if (byId.has(todo.id)) throw new Error(`invalid todos: duplicate id ${JSON.stringify(todo.id)}`)
    byId.set(todo.id, todo)
  }
  const complete = new Set<TodoId>()
  const visiting = new Set<TodoId>()
  const visit = (id: TodoId): void => {
    if (complete.has(id)) return
    if (visiting.has(id)) throw new Error(`invalid todos: dependency cycle at ${JSON.stringify(id)}`)
    visiting.add(id)
    const dependencies = byId.get(id)?.dependsOn ?? []
    if (new Set(dependencies).size !== dependencies.length) {
      throw new Error(`invalid todo ${JSON.stringify(id)}: duplicate dependency`)
    }
    for (const dependency of dependencies) {
      if (!byId.has(dependency)) throw new Error(`invalid todo ${JSON.stringify(id)}: unknown dependency ${JSON.stringify(dependency)}`)
      visit(dependency)
    }
    visiting.delete(id)
    complete.add(id)
  }
  for (const id of byId.keys()) visit(id)
}

const TODO_PROPERTIES = {
  content: { type: 'string', required: true, description: 'What the task is — a short imperative line.' },
  status: {
    type: 'string', required: true, enum: [...STATUSES],
    description: 'pending (not started or waiting) | in_progress (now) | completed (done).',
  },
  id: { type: 'string', description: 'Stable task id; keep it when updating or renaming the task.' },
  phase: { type: 'string', description: 'Stage grouping, such as research, implementation, or verification.' },
  description: { type: 'string', description: 'Concrete work and input materials.' },
  expectedOutput: { type: 'string', description: 'Expected deliverable or observable acceptance criterion.' },
  dependsOn: { type: 'array', items: { type: 'string' }, description: 'Prerequisite task ids in this complete list; requires this task to have an id. Must be acyclic.' },
  blockedReason: { type: 'string', description: 'Why the task is waiting, including a question or missing input.' },
  sessionId: { type: 'string', description: 'Published child session id executing this task, when delegated.' },
  result: { type: 'string', description: 'Result summary or concrete verification evidence.' },
  artifacts: { type: 'array', items: { type: 'string' }, description: 'Output file paths, absolute or relative to the session working directory.' },
} as const

/** Wire payload schema of the `todos` projection (whole list or pre-first-write null). */
const todosProjectionSchema: ZodType<TodoItem[] | null> = zod.union([
  zod.array(zod.object({
    content: zod.string(),
    status: zod.union([zod.literal('pending'), zod.literal('in_progress'), zod.literal('completed')]),
    id: zod.string().transform(id => id as TodoId).optional(),
    phase: zod.string().optional(),
    description: zod.string().optional(),
    expectedOutput: zod.string().optional(),
    dependsOn: zod.array(zod.string().transform(id => id as TodoId)).optional(),
    blockedReason: zod.string().optional(),
    sessionId: zod.string().transform(id => id as SessionId).optional(),
    result: zod.string().optional(),
    artifacts: zod.array(zod.string()).optional(),
  })).transform(todos => toTodoList(todos, true)),
  zod.null(),
])

/**
 * Register the `todo_write` tool on `ctx.tools` and the `todos` unit on
 * `ctx.sessionProjections`.
 * @param ctx - registrant context carrying the tool and session-projection registries.
 * @param config - deployment's explicit todo policy.
 * @returns when the plugin is ready.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const allowParallel = config.allowParallelInProgress
  // Standing-plan fold: latest whole todo/write list, cleared by the next
  // turn/start (turn/end keeps the finished checklist visible); null before the
  // first write or after a later turn begins; every other event returns the
  // same state reference.
  const projection = await ctx.sessionProjections.register({
    key: 'todos',
    stateSchema: zod.object({ turn: zod.number(), todos: todosProjectionSchema }),
    init: () => ({ turn: 0, todos: null as TodoItem[] | null }),
    apply: (state, event) => {
      if (event.type === 'todo/write') return { ...state, todos: event.data.todos }
      if (event.type === 'turn/start') return { turn: event.data.turn, todos: null }
      return state
    },
    wire: { viewSchema: todosProjectionSchema, view: state => state.todos, summary: false },
    stateVersion: 3,
  })
  ctx.tools.register(defineTool({
    name: 'todo_write',
    description: describe(allowParallel),
    parameters: {
      todos: {
        type: 'array',
        required: true,
        description: 'The COMPLETE task list, replacing any previous list.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: TODO_PROPERTIES,
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          todos: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: TODO_PROPERTIES,
            },
          },
          counts: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              pending: { type: 'integer', required: true },
              inProgress: { type: 'integer', required: true },
              completed: { type: 'integer', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Updated todo list: ${value.counts.pending} pending, ${value.counts.inProgress} in progress, ${value.counts.completed} completed.`,
      }],
    },
    execute(args, exec) {
      const todos = toTodoList(args.todos, allowParallel)
      if (!exec.agent) {
        // The list is per-agent-session state; a non-agent caller (no owning
        // session) has nowhere to write it. Reject rather than silently no-op.
        throw new Error('todo_write requires an owning agent session')
      }
      const { turn } = projection.stateOf(exec.agent.session)
      exec.agent.session.append('todo/write', { todos, ...turn > 0 ? { turn } : {} })
      const count = (status: TodoItem['status']): number => todos.filter(t => t.status === status).length
      return Promise.resolve({
        todos,
        counts: {
          pending: count('pending'),
          inProgress: count('in_progress'),
          completed: count('completed'),
        },
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Update todo list', kind: 'other', rawInput: args.todos }),
  }))
}
