/** Local diagnostics queries over registered Session projections; no remote reporting or log mutation. */
import { createHash } from 'node:crypto'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import type { DiagnosticGroup, DiagnosticGroupId, DiagnosticList, DiagnosticOccurrence, DiagnosticQuery } from './types.ts'
import { diagnosticProjection } from './projection.ts'
export type * from './types.ts'

/** Configurable local retention, response and explicit historical-index work bounds. */
export interface Config {
  /** Maximum newest failures retained in each Session's derived index. */
  maxOccurrencesPerSession: number
  /** Character limit for each redacted failure excerpt. */
  maxDetailChars: number
  /** Maximum matching occurrences in one grouped response. */
  maxOccurrencesPerQuery: number
  /** Maximum historical Session logs opened by one explicit index refresh. */
  maxSessionsPerRefresh: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Read-only local diagnostics and explicit historical-index work. */
    sessionDiagnostics: SessionDiagnostics
  }
}

/** Host owner of the local error index, authenticated query and refresh endpoints. */
export default class SessionDiagnostics extends TypertRemoteService {
  static inject = ['sessions', 'sessionQuery', 'sessionProjections', 'sessionProjectionCache', 'remoteAccess']
  static Config: z<Partial<Config>, Config> = z.object({
    maxOccurrencesPerSession: z.natural().min(1).max(10_000).default(500),
    maxDetailChars: z.natural().min(256).max(16_384).default(2048),
    maxOccurrencesPerQuery: z.natural().min(1).max(10_000).default(1000),
    maxSessionsPerRefresh: z.natural().min(1).max(1000).default(100),
  })

  /** @param ctx - Host services. @param config - Validated local work and retention limits. */
  constructor(ctx: Context, private readonly config: Config) { super(ctx, 'sessionDiagnostics') }

  protected async [Service.init](): Promise<void> {
    await this.ctx.sessionProjections.register(diagnosticProjection({
      maxOccurrencesPerSession: this.config.maxOccurrencesPerSession,
      maxDetailChars: this.config.maxDetailChars,
    }))
  }

  /**
   * Read current live values and historical cached values without opening cold logs.
   * @param request - Explicit scope and filters.
   * @param signal - Request cancellation.
   * @returns Redacted groups with visible missing-index and truncation counts.
   */
  @Remote
  async list(request: DiagnosticQuery, signal: AbortSignal): Promise<DiagnosticList> {
    const records = await this.authorized(request, signal)
    return this.collect(records, request, signal)
  }

  /**
   * Index a bounded batch of authorized historical logs; missing rows are prioritized.
   * Original logs and their events remain unchanged. Failed reads remain visibly unindexed.
   * @param request - Explicit scope and filters; text filters do not narrow index work.
   * @param signal - Cancellation checked before and after every log read.
   * @returns Current redacted groups and any independent Session read failures.
   */
  @Remote
  async refresh(request: DiagnosticQuery, signal: AbortSignal): Promise<DiagnosticList> {
    const records = await this.authorized(request, signal)
    const historical = records.filter(record => !record.live).sort((a, b) => {
      const cached = (record: SessionRecord): number => Number(this.ctx.sessionProjectionCache.cachedSnapshot(record.header, ['diagnostics'])?.values.diagnostics !== undefined)
      return cached(a) - cached(b) || b.header.createdAt - a.header.createdAt
    })
    let failures = 0
    const refreshed = new Map<string, ReturnType<Context['sessionProjectionCache']['coldSnapshot']>>()
    for (const record of historical.slice(0, this.config.maxSessionsPerRefresh)) {
      signal.throwIfAborted()
      if (!this.ctx.remoteAccess.allows({ kind: 'session', id: record.header.id })) continue
      try {
        const snapshot = await this.ctx.sessionQuery.readSession(record.header.id)
        signal.throwIfAborted()
        if (!this.ctx.remoteAccess.allows({ kind: 'session', id: record.header.id })) continue
        const indexed = this.ctx.sessionProjectionCache.coldSnapshot(snapshot.session, snapshot.inheritedEventCount, snapshot.events)
        refreshed.set(record.header.id, indexed)
      } catch (error: unknown) {
        signal.throwIfAborted()
        failures++
        this.ctx.logger.warn(`diagnostics: historical Session ${record.header.id} could not be indexed: ${String(error)}`)
      }
    }
    return this.collect(records, request, signal, refreshed, failures)
  }

  private async authorized(request: DiagnosticQuery, signal: AbortSignal): Promise<SessionRecord[]> {
    signal.throwIfAborted()
    const records = await this.ctx.sessionQuery.listSessions(signal)
    return records.filter(record => this.ctx.remoteAccess.allows({ kind: 'session', id: record.header.id })
      && (request.scope?.kind !== 'cwd' || record.header.cwd === request.scope.cwd)
      && (request.scope?.kind !== 'session' || record.header.id === request.scope.sessionId))
  }

  private collect(
    records: SessionRecord[], request: DiagnosticQuery, signal: AbortSignal,
    refreshed = new Map<string, ReturnType<Context['sessionProjectionCache']['coldSnapshot']>>(), failures = 0,
  ): DiagnosticList {
    const rows: DiagnosticOccurrence[] = []
    let unindexed = 0
    let omitted = 0
    let scannedEvents = 0
    let scannedSessions = 0
    const search = request.search?.trim().toLocaleLowerCase()
    for (const record of records) {
      signal.throwIfAborted()
      if (!this.ctx.remoteAccess.allows({ kind: 'session', id: record.header.id })) continue
      const live = this.ctx.sessions.get(record.header.id)
      const snapshot = live === undefined
        ? refreshed.get(record.header.id) ?? this.ctx.sessionProjectionCache.cachedSnapshot(record.header, ['diagnostics'])
        : this.ctx.sessionProjections.snapshot(live, ['diagnostics'])
      const value = snapshot?.values.diagnostics
      if (value === undefined) { unindexed++; continue }
      scannedSessions++
      scannedEvents += (snapshot?.asOfSeq ?? -1) + 1
      omitted += value.omitted
      for (const occurrence of value.records) {
        if (request.since !== undefined && occurrence.at < request.since) continue
        if (request.category !== undefined && occurrence.category !== request.category) continue
        if (search && !`${occurrence.source} ${occurrence.code} ${occurrence.message} ${occurrence.details}`.toLocaleLowerCase().includes(search)) continue
        rows.push(occurrence)
      }
      if (rows.length > this.config.maxOccurrencesPerQuery) {
        rows.sort((a, b) => b.at - a.at || b.eventSeq - a.eventSeq)
        omitted += rows.length - this.config.maxOccurrencesPerQuery
        rows.length = this.config.maxOccurrencesPerQuery
      }
    }
    rows.sort((a, b) => b.at - a.at || b.eventSeq - a.eventSeq)
    const groups = new Map<DiagnosticGroupId, DiagnosticGroup>()
    for (const occurrence of rows) {
      const { category, source, code, message } = occurrence
      const id = createHash('sha256').update(JSON.stringify([category, source, code, message])).digest('hex') as DiagnosticGroupId
      const current = groups.get(id)
      if (current === undefined) {
        groups.set(id, {
          id, category, source, code, message, count: 1, firstAt: occurrence.at, lastAt: occurrence.at, occurrences: [occurrence],
        })
      } else {
        current.count++
        current.firstAt = Math.min(current.firstAt, occurrence.at)
        current.lastAt = Math.max(current.lastAt, occurrence.at)
        current.occurrences.push(occurrence)
      }
    }
    return {
      groups: [...groups.values()].sort((a, b) => b.lastAt - a.lastAt || a.id.localeCompare(b.id)),
      incomplete: unindexed > 0 || omitted > 0 || failures > 0,
      scannedSessions, scannedEvents,
      unindexedSessions: unindexed, omittedOccurrences: omitted, failedSessions: failures,
    }
  }
}
