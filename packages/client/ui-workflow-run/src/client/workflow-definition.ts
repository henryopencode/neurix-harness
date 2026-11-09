import type {
  ConversationLocation, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ToolWorkflowAgentEndData, ToolWorkflowAgentStartData,
} from '@deepseek-ai/dsh-tool-workflow/types'
import type { WorkflowAgentOutcome, WorkflowStopReason } from '@deepseek-ai/dsh-workflow/types'
import type { WorkflowCanvasNode } from './canvas-contract.ts'
import { abandonedTurnSeq } from './workflow-lifecycle.ts'

/** Status shown for a workflow, phase, or member. */
export type WorkflowRunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

/** Final renderer data for one member. */
export interface WorkflowRunMemberData {
  readonly seq: number
  readonly label: string
  readonly childId: SessionId
  readonly status: WorkflowRunStatus
}

/** Final renderer data for one exact phase identity. */
export interface WorkflowRunPhaseData {
  readonly key: string
  /** `null` is the absent field; the empty string remains a distinct identity. */
  readonly phase: string | null
  readonly members: readonly WorkflowRunMemberData[]
}

/** Final keyed Chat payload for one workflow run. */
export interface WorkflowRunChatData {
  readonly name: string
  readonly status: WorkflowRunStatus
  readonly phases: readonly WorkflowRunPhaseData[]
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Durable top-level workflow run and all members that actually started. */
    'workflow-run': WorkflowRunChatData
  }
}

interface WorkflowMemberState extends Omit<ToolWorkflowAgentStartData, 'runId'> {
  readonly outcome?: WorkflowAgentOutcome
  readonly executionSeq: number
}

interface WorkflowState {
  readonly name: string
  readonly stopReason?: WorkflowStopReason
  readonly members: readonly WorkflowMemberState[]
  readonly seq: number
}

/**
 * Build a collision-free phase key preserving absent versus empty identity.
 * @param phase - exact phase string, or null for an omitted field.
 * @returns the stable renderer key for that phase identity.
 */
export function workflowPhaseKey(phase: string | null): string {
  return phase === null ? 'missing' : `value:${phase.length}:${phase}`
}

function statusFromStopReason(stopReason: WorkflowStopReason): WorkflowRunStatus {
  switch (stopReason) {
    case 'completed': return 'completed'
    case 'cancelled': return 'cancelled'
    case 'error': return 'failed'
    /* v8 ignore next -- WorkflowStopReason is closed and every variant is handled above. */
    default: return stopReason satisfies never
  }
}

function statusFromOutcome(outcome: WorkflowAgentOutcome): WorkflowRunStatus {
  switch (outcome) {
    case 'completed': return 'completed'
    case 'cancelled': return 'cancelled'
    case 'failed': return 'failed'
    /* v8 ignore next -- WorkflowAgentOutcome is closed and every variant is handled above. */
    default: return outcome satisfies never
  }
}

/**
 * A foreground run writes its run-end before its Tool Step ends, and a
 * background run outlives that Step, so an ordinary Step or Turn closure says
 * nothing about liveness. Only a Turn closed after a crash or at a fork
 * boundary proves that a run without run-end stopped.
 */
function projectWorkflow(
  context: ConversationNodeContext<WorkflowState>,
  location: ConversationLocation,
): WorkflowRunChatData {
  const state = context.state as WorkflowState
  const interrupted = state.stopReason === undefined
    && abandonedTurnSeq(location) !== undefined
  const phases = new Map<string, { phase: string | null; members: WorkflowRunMemberData[] }>()
  for (const member of state.members) {
    const phase = member.phase === undefined ? null : member.phase
    const key = workflowPhaseKey(phase)
    let group = phases.get(key)
    if (group === undefined) {
      group = { phase, members: [] }
      phases.set(key, group)
    }
    group.members.push({
      seq: member.seq,
      label: member.label,
      childId: member.childId,
      status: member.outcome === undefined
        ? interrupted ? 'interrupted' : 'running'
        : statusFromOutcome(member.outcome),
    })
  }
  const projectedPhases = [...phases].map(([key, phase]) => ({
    key,
    phase: phase.phase,
    members: phase.members,
  }))
  return {
    name: state.name,
    status: state.stopReason === undefined
      ? interrupted ? 'interrupted' : 'running'
      : statusFromStopReason(state.stopReason),
    phases: projectedPhases,
  }
}

function updateAgentStart(state: WorkflowState, data: ToolWorkflowAgentStartData, seq: number): WorkflowState {
  const member: WorkflowMemberState = {
    executionSeq: seq,
    seq: data.seq,
    label: data.label,
    ...data.phase === undefined ? {} : { phase: data.phase },
    childId: data.childId,
  }
  return { ...state, seq, members: [...state.members, member] }
}

function updateAgentEnd(state: WorkflowState, data: ToolWorkflowAgentEndData, seq: number): WorkflowState {
  return {
    ...state,
    seq,
    members: state.members.map(member => member.seq === data.seq
      ? { ...member, outcome: data.outcome, executionSeq: seq }
      : member),
  }
}

/** Durable workflow event family folded into one keyed Chat node. */
export const workflowRunDefinition: ConversationNodeDefinition<WorkflowState> = {
  kind: 'workflow-run',
  target: 'chat',
  match: (event) => {
    if (event.type === 'tool-workflow/run-start') return { id: String(event.data.runId), role: 'start' }
    if (event.type === 'tool-workflow/agent-start'
      || event.type === 'tool-workflow/agent-end'
      || event.type === 'tool-workflow/run-end') {
      return { id: String(event.data.runId), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'tool-workflow/run-start') {
      throw new Error('workflow-run start requires tool-workflow/run-start')
    }
    return { name: match.event.data.name, members: [], seq: match.event.seq }
  },
  update: (context, match) => {
    if (match.event.type === 'tool-workflow/agent-start') {
      return updateAgentStart(context.state, match.event.data, match.event.seq)
    }
    if (match.event.type === 'tool-workflow/agent-end') {
      return updateAgentEnd(context.state, match.event.data, match.event.seq)
    }
    if (match.event.type === 'tool-workflow/run-end') {
      return { ...context.state, stopReason: match.event.data.stopReason, seq: match.event.seq }
    }
    return context.state
  },
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.start === undefined) return null
    const data = projectWorkflow(context, context.start.location)
    return {
      key: context.key,
      kind: 'workflow-run',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: context.start.location,
      visibility: 'visible',
      data,
    }
  },
}

/** The canvas projects the same run facts without introducing dependency edges. */
export const workflowCanvasRunDefinition: ConversationNodeDefinition<WorkflowState> = {
  ...workflowRunDefinition,
  kind: 'workflow-canvas-run',
  target: 'workflow',
  buildViewNode: (context): WorkflowCanvasNode | null => {
    if (context.start === undefined || context.state === undefined) return null
    const location = context.start.location
    const state = context.state
    const interruptedAt = state.stopReason === undefined ? abandonedTurnSeq(location) : undefined
    return {
      key: context.key, kind: context.kind, id: context.id, target: 'workflow',
      data: {
        id: `run:${context.id}`,
        seq: interruptedAt ?? state.seq,
        ...location.kind === 'turn' || location.kind === 'step' ? { turn: location.turn.turn } : {},
        name: state.name,
        source: 'run',
        tasks: state.members.map(member => ({
          id: `member:${member.seq}`,
          content: member.label,
          status: member.outcome === undefined
            ? interruptedAt === undefined ? 'running' : 'interrupted'
            : statusFromOutcome(member.outcome),
          ...member.phase === undefined ? {} : { phase: member.phase },
          sessionId: member.childId,
          executionSeq: member.outcome === undefined ? interruptedAt ?? member.executionSeq : member.executionSeq,
          dependsOn: [],
        })),
      },
    }
  },
}
