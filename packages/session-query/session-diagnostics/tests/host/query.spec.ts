/** Explicit historical indexing never substitutes missing cache rows with an empty success. */
import { Context } from '@deepseek-ai/cordis'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry, { type ProjectionSnapshot } from '@deepseek-ai/dsh-session-projection'
import type { SessionLogSnapshot, SessionRecord } from '@deepseek-ai/dsh-session-query'
import { expect, it, onTestFinished, vi } from 'vitest'
import SessionDiagnostics from '../../src/index.ts'

async function fixture(maxSessionsPerRefresh = 10, maxOccurrencesPerQuery = 20) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const records: SessionRecord[] = []
  const corpus = new Map<SessionId, SessionLogSnapshot>()
  const cached = new Map<SessionId, ProjectionSnapshot>()
  const denied = new Set<SessionId>()
  const listSessions = vi.fn(async () => records)
  const readSession = vi.fn(async (id: SessionId): Promise<SessionLogSnapshot> => {
    const found = corpus.get(id)
    if (found === undefined) throw new Error('missing test log')
    return found
  })
  const coldSnapshot = vi.fn((header: SessionHeader, inherited: SessionLogOffset, events: readonly SessionEvent[]) =>
    ctx.sessionProjections.restore({}, events, SessionLogOffset(0), header, inherited).snapshot)
  ctx.provide('sessionQuery', { listSessions, readSession })
  ctx.provide('sessionProjectionCache', { cachedSnapshot: (header: SessionHeader) => cached.get(header.id), coldSnapshot })
  ctx.provide('remoteAccess', { allows: (resource: { id: SessionId }) => !denied.has(resource.id) })
  await ctx.plugin(SessionDiagnostics, { maxOccurrencesPerSession: 10, maxDetailChars: 256, maxSessionsPerRefresh, maxOccurrencesPerQuery })
  function add(id: string, cwd = '/project', message = 'required field missing') {
    const sessionId = SessionId(id)
    const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: records.length + 1, isSeeded: false, cwd }
    const callId = ToolCallId(`call-${id}`)
    const events: SessionEvent[] = [
      { type: 'tool/call', seq: SessionSeq(0), time: 100, data: { turn: 1, step: 1, callId, name: 'todo_write', arguments: '{}' } },
      { type: 'tool/result', seq: SessionSeq(1), time: 101 + records.length, surfaceOp: 'append', sourceEventSeqs: [SessionSeq(0)], data: {
        turn: 1, step: 1,
        message: createToolResultMessage({ callId, isError: true, content: [{ type: 'text', text: message }] }),
        error: { name: 'Error', code: 'INVALID_ARGS' },
      } },
    ]
    records.push({ header, live: false, persisted: true })
    corpus.set(sessionId, { session: header, inheritedEventCount: SessionLogOffset(0), events })
    return { id: sessionId, header, events }
  }
  const list = () => ctx.sessionDiagnostics.list({}, new AbortController().signal)
  const refresh = () => ctx.sessionDiagnostics.refresh({}, new AbortController().signal)
  return { ctx, records, corpus, cached, denied, readSession, coldSnapshot, add, list, refresh }
}

it('shows missing indexes without opening cold logs from the list endpoint', async () => {
  const { add, list, readSession, coldSnapshot } = await fixture()
  add('old')
  expect(await list()).toMatchObject({ groups: [], incomplete: true, unindexedSessions: 1, scannedSessions: 0 })
  expect(readSession).not.toHaveBeenCalled()
  expect(coldSnapshot).not.toHaveBeenCalled()
})

it('returns explicit refresh results before asynchronous cache writeback', async () => {
  const { add, refresh, cached, readSession } = await fixture()
  add('first')
  add('second')
  const data = await refresh()
  expect(data).toMatchObject({ incomplete: false, unindexedSessions: 0, scannedSessions: 2 })
  expect(data.groups).toHaveLength(1)
  expect(data.groups[0]?.count).toBe(2)
  expect(data.groups[0]?.occurrences.map(row => row.sessionId)).toEqual(['second', 'first'])
  expect(cached.size).toBe(0)
  expect(readSession).toHaveBeenCalledTimes(2)
})

it('bounds a refresh and retains a visible count of unindexed sessions', async () => {
  const { add, refresh, readSession } = await fixture(1)
  add('older')
  add('newer')
  expect(await refresh()).toMatchObject({ incomplete: true, scannedSessions: 1, unindexedSessions: 1 })
  expect(readSession).toHaveBeenCalledExactlyOnceWith(SessionId('newer'))
})

it('continues independent reads and reports incomplete coverage after a corrupt log', async () => {
  const { add, refresh, readSession } = await fixture()
  add('good')
  add('bad')
  readSession.mockRejectedValueOnce(new Error('corrupt test log'))
  expect(await refresh()).toMatchObject({ incomplete: true, failedSessions: 1, unindexedSessions: 1, scannedSessions: 1 })
  expect(readSession).toHaveBeenCalledTimes(2)
})

it('filters unauthorized sessions before reads and rechecks after an awaited read', async () => {
  const { ctx, add, denied, readSession, coldSnapshot } = await fixture()
  const first = add('denied')
  denied.add(first.id)
  const next = add('revoked')
  readSession.mockImplementationOnce(async () => {
    denied.add(next.id)
    return { session: next.header, events: next.events, inheritedEventCount: SessionLogOffset(0) }
  })
  const data = await ctx.sessionDiagnostics.refresh({}, new AbortController().signal)
  expect(readSession).toHaveBeenCalledExactlyOnceWith(next.id)
  expect(coldSnapshot).not.toHaveBeenCalled()
  expect(data).toMatchObject({ groups: [], scannedSessions: 0, unindexedSessions: 0 })
})

it('applies project, text, time and category filters without exporting query paths', async () => {
  const { ctx, add } = await fixture()
  add('first', '/wanted', 'missing required property')
  add('second', '/other', 'other failure')
  const data = await ctx.sessionDiagnostics.refresh({ scope: { kind: 'cwd', cwd: '/wanted' }, search: 'REQUIRED', since: 100, category: 'arguments' }, new AbortController().signal)
  expect(data.groups).toHaveLength(1)
  expect(data.groups[0]?.occurrences[0]?.sessionId).toBe('first')
  expect(JSON.stringify(data)).not.toContain('/wanted')
})

it('limits a shortcut refresh to its authorized source Session', async () => {
  const { ctx, add, readSession, denied } = await fixture()
  const source = add('source')
  add('other')
  const data = await ctx.sessionDiagnostics.refresh({ scope: { kind: 'session', sessionId: source.id } }, new AbortController().signal)
  expect(readSession).toHaveBeenCalledExactlyOnceWith(source.id)
  expect(data.groups[0]?.occurrences.map(row => row.sessionId)).toEqual([source.id])
  denied.add(source.id)
  const hidden = await ctx.sessionDiagnostics.list({ scope: { kind: 'session', sessionId: source.id } }, new AbortController().signal)
  expect(hidden).toMatchObject({ groups: [], scannedSessions: 0, unindexedSessions: 0 })
})

it('bounds responses and marks omitted occurrences rather than hiding truncation', async () => {
  const { add, refresh } = await fixture(10, 1)
  add('first')
  add('second')
  const data = await refresh()
  expect(data).toMatchObject({ incomplete: true, omittedOccurrences: 1 })
  expect(data.groups[0]?.occurrences.map(row => row.sessionId)).toEqual(['second'])
})

it('does not fold or publish late work after request cancellation', async () => {
  const { ctx, add, readSession, coldSnapshot } = await fixture()
  const record = add('one')
  const abort = new AbortController()
  readSession.mockImplementationOnce(async () => {
    abort.abort(new Error('cancelled test request'))
    return { session: record.header, events: record.events, inheritedEventCount: SessionLogOffset(0) }
  })
  await expect(ctx.sessionDiagnostics.refresh({}, abort.signal)).rejects.toThrow('cancelled test request')
  expect(coldSnapshot).not.toHaveBeenCalled()
})
