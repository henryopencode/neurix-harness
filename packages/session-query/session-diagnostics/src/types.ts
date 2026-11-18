/** Public values of the local diagnostics query and report preview. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'

/** Stable identity of one derived failure group. */
export type DiagnosticGroupId = string & Branded<'DiagnosticGroupId'>
/** Identity of a failure occurrence within its owning Session. */
export type DiagnosticOccurrenceId = string & Branded<'DiagnosticOccurrenceId'>
/** Classification based on structured failure facts, not guessed causes. */
export type DiagnosticCategory = 'arguments' | 'command' | 'permission' | 'tool' | 'turn'
/** One bounded, redacted failure with a source reference; recovery is not inferred. */
export interface DiagnosticOccurrence {
  id: DiagnosticOccurrenceId
  sessionId: SessionId
  eventSeq: SessionSeq
  at: number
  turn: number | null
  step?: number | undefined
  message: string
  details: string
  category: DiagnosticCategory
  source: string
  code: string
}
/** Repeated failures sharing a category, component, code and redacted summary. */
export interface DiagnosticGroup {
  id: DiagnosticGroupId
  category: DiagnosticCategory
  source: string
  code: string
  message: string
  count: number
  firstAt: number
  lastAt: number
  occurrences: DiagnosticOccurrence[]
}
/** Source reference selected by a settled Tool card; no raw arguments are carried. */
export interface DiagnosticFocus {
  sessionId: SessionId
  eventSeq: SessionSeq
}
/** Explicit query scope; omitted scope means all authorized Sessions. */
export interface DiagnosticQuery {
  scope?: { kind: 'cwd'; cwd: string } | { kind: 'session'; sessionId: SessionId } | { kind: 'all' } | undefined
  since?: number | undefined
  category?: DiagnosticCategory | undefined
  search?: string | undefined
}
/** Bounded query result with visible omissions and historical-index coverage. */
export interface DiagnosticList {
  groups: DiagnosticGroup[]
  incomplete: boolean
  scannedSessions: number
  scannedEvents: number
  unindexedSessions: number
  omittedOccurrences: number
  failedSessions: number
}
/** Session-local derived facts; original Session events remain authoritative. */
export interface DiagnosticProjection {
  records: DiagnosticOccurrence[]
  omitted: number
}

import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    diagnostics: SessionProjectionSummaryExcluded<DiagnosticProjection>
  }
}
