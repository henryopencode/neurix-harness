/** Whole-plan replay keeps stable task identities and retains removed steps. */
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import type { WorkflowGraph, WorkflowTask } from './canvas-contract.ts'
import { abandonedTurnSeq } from './workflow-lifecycle.ts'

interface PlanState {
  readonly todos: readonly TodoItem[]
  readonly removed: readonly TodoItem[]
  readonly seq: number
}

function taskId(todo: TodoItem): string {
  return todo.id === undefined ? `content:${todo.content}` : `id:${todo.id}`
}

function tasks(state: PlanState, interrupted: boolean): WorkflowTask[] {
  const toTask = (todo: TodoItem, removed = false): WorkflowTask => ({
    ...todo,
    id: taskId(todo),
    status: removed ? 'removed' : todo.status === 'in_progress' ? interrupted ? 'interrupted' : 'running' : todo.status,
    dependsOn: todo.dependsOn?.map(id => `id:${id}`) ?? [],
    ...removed ? { removed: true } : {},
  })
  return [...state.todos.map(todo => toTask(todo)), ...state.removed.map(todo => toTask(todo, true))]
}

/**
 * Build one target's independent plan fold. Historical writes without turn ids are
 * whole checkpoints; the canvas Builder retains the latest checkpoint per resolved Turn.
 * @param target - the full canvas or automatically displayed Chat preview.
 * @returns effect-owned event definition for that target.
 */
export function createPlanDefinition(target: 'chat' | 'workflow'): ConversationNodeDefinition<PlanState> {
  return {
    kind: target === 'chat' ? 'workflow-plan' : 'workflow-canvas-plan',
    target,
    match: (event) => {
      if (event.type !== 'todo/write') return null
      if (target === 'chat' && event.data.turn === undefined) return null
      return { id: event.data.turn === undefined ? `write:${event.seq}` : `turn:${event.data.turn}`, role: 'start' }
    },
    start: (_context, match) => {
      if (match.event.type !== 'todo/write') throw new Error('workflow plan requires todo/write')
      return { todos: match.event.data.todos, removed: [], seq: match.event.seq }
    },
    update: (context, match) => {
      if (match.event.type !== 'todo/write') return context.state
      const todos = match.event.data.todos
      const current = new Set(todos.map(taskId))
      const removed = [...context.state.removed, ...context.state.todos].filter(todo => !current.has(taskId(todo)))
      return { todos, removed, seq: match.event.seq }
    },
    publication: () => 'immediate',
    buildViewNode: (context) => {
      if (context.start === undefined || context.state === undefined) return null
      const location = context.start.location
      const turn = location.kind === 'turn' || location.kind === 'step' ? location.turn.turn : undefined
      const data: WorkflowGraph = {
        id: turn === undefined ? context.id : `turn:${turn}`,
        seq: context.state.seq,
        ...turn === undefined ? {} : { turn },
        source: 'plan',
        tasks: tasks(context.state, abandonedTurnSeq(location) !== undefined),
      }
      if (target === 'workflow') return { key: context.key, kind: context.kind, id: context.id, target, data }
      if (data.tasks.length < 2) return null
      return {
        key: context.key, kind: 'workflow-plan', id: context.id, target: 'chat',
        anchorSeq: context.start.event.seq, location, visibility: 'visible', data,
      }
    },
  }
}
