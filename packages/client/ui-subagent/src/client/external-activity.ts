/** Project the display-only activity of each native subagent into one chat row. */
import type { SubagentActivityEvent } from '@deepseek-ai/dsh-subagent/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'

type Started = Extract<SubagentActivityEvent, { kind: 'started' }>
type Finished = Extract<SubagentActivityEvent, { kind: 'finished' }>
type Update = Exclude<SubagentActivityEvent, Started | Finished>

interface ExternalActivityData {
  readonly invocation: Started
  readonly updates: readonly { readonly seq: number; readonly item: Update }[]
  readonly terminal?: Finished
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** User-facing native subagent task, progress, and outcome. */
    'external-agent-activity': ExternalActivityData
  }
}

/** Replay native activity in log order, with the row anchored where the call was accepted. */
export const externalActivityDefinition: ConversationNodeDefinition<ExternalActivityData> = {
  kind: 'external-agent-activity',
  target: 'chat',
  match: event => event.type === 'subagent/activity'
    ? { id: event.data.childId, role: event.data.kind === 'started' ? 'start' : 'update' }
    : null,
  start: (_context, { event }) => {
    if (event.type !== 'subagent/activity' || event.data.kind !== 'started') {
      throw new Error('external-agent activity start requires a native invocation')
    }
    return { invocation: event.data, updates: [] }
  },
  update: ({ state }, { event }) => {
    if (event.type !== 'subagent/activity' || event.data.kind === 'started' || state.terminal !== undefined) return state
    if (event.data.kind === 'finished') return { ...state, terminal: event.data }
    return { ...state, updates: [...state.updates, { seq: event.seq, item: event.data }] }
  },
  buildViewNode: ({ start, state, key, id }) => {
    if (start === undefined || state === undefined) return null
    return {
      key, id, kind: 'external-agent-activity', target: 'chat',
      anchorSeq: start.event.seq, location: start.location, visibility: 'visible', groupTree: 'turn', data: state,
    } satisfies ChatNode<'external-agent-activity'>
  },
}
