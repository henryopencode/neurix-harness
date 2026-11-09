/** Recorded turn and tool activity keeps the canvas current before a detailed plan arrives. */
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TurnEndReason } from '@deepseek-ai/dsh-session/types'
import type { WorkflowCanvasNode, WorkflowTask, WorkflowTaskStatus } from './canvas-contract.ts'
import { abandonedTurnSeq } from './workflow-lifecycle.ts'

interface TurnActivity {
  readonly turn: number
  readonly seq: number
  readonly status: WorkflowTaskStatus
  readonly tools: readonly WorkflowTask[]
}

function turnStatus(reason: TurnEndReason): WorkflowTaskStatus {
  switch (reason.kind) {
    case 'completed': return 'completed'
    case 'error': return 'failed'
    case 'aborted': return 'cancelled'
    case 'blocked': return 'blocked'
    // Unknown plugin-owned endings do not establish a completed turn.
    default: return 'interrupted'
  }
}

/** Every started turn has a canvas entry; a detailed plan for that turn takes precedence. */
export const turnActivityDefinition: ConversationNodeDefinition<TurnActivity> = {
  kind: 'workflow-turn',
  target: 'workflow',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'turn/end' || event.type === 'tool/call' || event.type === 'tool/result'
      || event.type === 'step/start') return { id: String(event.data.turn), role: 'update' }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('workflow turn requires turn/start')
    return { turn: match.event.data.turn, seq: match.event.seq, status: 'running', tools: [] }
  },
  update: ({ state }, { event }) => {
    if (event.type === 'tool/call') return {
      ...state, seq: event.seq, tools: [...state.tools, {
        id: `call:${event.data.callId}`, content: event.data.name, status: 'running', dependsOn: [],
      }],
    }
    if (event.type === 'tool/result') return {
      ...state, seq: event.seq,
      tools: state.tools.map(task => task.id === `call:${event.data.message.source.callId}`
        ? { ...task, status: event.data.message.isError ? 'failed' : 'completed' } : task),
    }
    if (event.type === 'turn/end') return { ...state, seq: event.seq, status: turnStatus(event.data.reason) }
    return { ...state, seq: event.seq }
  },
  buildViewNode: (context): WorkflowCanvasNode | null => {
    if (context.start === undefined || context.state === undefined) return null
    const { state } = context
    const interrupted = abandonedTurnSeq(context.start.location) !== undefined
    const status = interrupted ? 'interrupted' : state.status
    return {
      key: context.key, kind: context.kind, id: context.id, target: 'workflow',
      data: {
        id: `turn:${state.turn}`, turn: state.turn, seq: state.seq, source: 'turn',
        tasks: [
          { id: `turn:${state.turn}`, content: '', titleKey: 'task.request', status, dependsOn: [] },
          ...state.tools.map(task => task.status === 'running' && status !== 'running'
            ? { ...task, status: 'interrupted' as const } : task),
        ],
      },
    }
  },
}
