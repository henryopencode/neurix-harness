/** Deterministic, replayable diagnostics derived only from committed Session events. */
import z from 'zod'
import type { SessionEvent, SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type {} from '@deepseek-ai/dsh-tool-executor-ptc/types'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { DiagnosticOccurrence, DiagnosticOccurrenceId, DiagnosticProjection } from './types.ts'
import { redactDiagnostic } from './redact.ts'
import { diagnosticToolFailure } from './classify.ts'

/** Bounds are part of the cache identity so changing retention cannot reuse old checkpoints. */
export interface ProjectionLimits {
  maxOccurrencesPerSession: number
  maxDetailChars: number
}
const occurrenceSchema = z.object({
  id: z.string().transform(value => value as DiagnosticOccurrenceId),
  sessionId: z.string().transform(value => value as SessionId),
  eventSeq: z.number().int().nonnegative().transform(value => value as SessionSeq),
  at: z.number(), turn: z.number().nullable(), step: z.number().optional(),
  message: z.string(), details: z.string(),
  category: z.enum(['arguments', 'command', 'permission', 'tool', 'turn']),
  source: z.string(), code: z.string(),
})
const viewSchema = z.object({ records: z.array(occurrenceSchema), omitted: z.number().int().nonnegative() })
interface Call {
  name: string
  turn: number
  step: number
}
interface State {
  sessionId: SessionId
  inherited: number
  policy: string
  calls: Record<string, Call>
  view: DiagnosticProjection
}

/**
 * Construct the private Session fold; inherited failures are not counted again in forks.
 * @param limits - Validated retention and text bounds.
 * @returns Registered projection definition with a summary-excluded client value.
 */
export function diagnosticProjection(limits: ProjectionLimits): ProjectionDefinition<'diagnostics', State> & { wire: NonNullable<ProjectionDefinition<'diagnostics', State>['wire']> } {
  const policy = JSON.stringify(limits)
  const stateSchema = z.object({
    sessionId: z.string().transform(value => value as SessionId), inherited: z.number(), policy: z.literal(policy),
    calls: z.record(z.string(), z.object({ name: z.string(), turn: z.number(), step: z.number() })), view: viewSchema,
  })
  return {
    key: 'diagnostics', stateVersion: 1, stateSchema,
    init: (header, inherited) => ({ sessionId: header.id, inherited, policy, calls: {}, view: { records: [], omitted: 0 } }),
    apply: (state, event) => {
      if (event.seq < state.inherited) return state
      if (event.type === 'tool/call') {
        const entries = Object.entries(state.calls).filter(([id]) => id !== event.data.callId)
        entries.push([event.data.callId, { name: redactDiagnostic(event.data.name, 240), turn: event.data.turn, step: event.data.step }])
        return { ...state, calls: Object.fromEntries(entries.slice(-limits.maxOccurrencesPerSession)) }
      }
      const callId = event.type === 'tool/result' ? event.data.message.toolCallId : event.type === 'tool/ptc-dispatch' ? event.data.rootCallId : undefined
      const call = callId !== undefined && Object.hasOwn(state.calls, callId) ? state.calls[callId] : undefined
      let next = state
      if (event.type === 'tool/result' && call !== undefined) {
        const calls = Object.fromEntries(Object.entries(state.calls).filter(([id]) => id !== callId))
        next = { ...state, calls }
      } else if (event.type === 'turn/end' && Object.keys(state.calls).length > 0) { next = { ...state, calls: {} } }
      const record = occurrence(state.sessionId, event, limits.maxDetailChars, call)
      if (record === undefined) return next
      const overflow = state.view.records.length >= limits.maxOccurrencesPerSession
      return { ...next, view: {
        records: [...(overflow ? state.view.records.slice(1) : state.view.records), record],
        omitted: state.view.omitted + Number(overflow),
      } }
    },
    wire: { viewSchema, summary: false, view: state => state.view },
  }
}

function renderedExcerpt(blocks: readonly ContentBlock[], limit: number): string {
  let text = ''
  for (const block of blocks) {
    if (block.type !== 'text') continue
    if (text !== '') text += '\n'
    text += block.text.slice(0, limit - text.length)
    if (text.length >= limit) break
  }
  return text
}

function occurrence(sessionId: SessionId, event: SessionEvent, maxChars: number, call: Call | undefined): DiagnosticOccurrence | undefined {
  let facts: Pick<DiagnosticOccurrence, 'category' | 'code' | 'source'>
  let text: string
  let turn: number | null
  let step: number | undefined
  if (event.type === 'tool/result' || event.type === 'tool/ptc-dispatch') {
    const { error } = event.data
    const message = event.type === 'tool/result' ? event.data.message : event.data
    const failure = diagnosticToolFailure({ isError: message.isError, error, meta: event.data.meta })
    if (failure === undefined) return undefined
    facts = {
      category: failure.category,
      source: event.type === 'tool/ptc-dispatch' ? redactDiagnostic(event.data.name, 240) : call?.name ?? 'tool',
      code: redactDiagnostic(failure.code, 120),
    }
    text = error?.reason ?? renderedExcerpt(message.content, maxChars * 4)
    turn = event.type === 'tool/result' ? event.data.turn : call?.turn ?? null
    step = event.type === 'tool/result' ? event.data.step : call?.step
  } else if (event.type === 'turn/end' && event.data.reason.kind === 'error') {
    facts = { category: 'turn', source: 'agent', code: event.data.reason.error.code }
    text = event.data.reason.error.message
    turn = event.data.turn
  } else { return undefined }
  const details = redactDiagnostic(text, maxChars)
  return {
    id: `${sessionId}:${event.seq}` as DiagnosticOccurrenceId, sessionId, eventSeq: event.seq,
    at: event.time, turn, ...(step === undefined ? {} : { step }), ...facts,
    message: redactDiagnostic(details.split('\n').find(line => line.trim() !== '') ?? facts.code, Math.min(maxChars, 240)), details,
  }
}
