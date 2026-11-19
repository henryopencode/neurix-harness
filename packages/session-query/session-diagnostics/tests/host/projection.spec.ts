/** Live and replayed diagnostics use structured facts, bounded excerpts and owned registrations. */
import { Context } from '@deepseek-ai/cordis'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import SessionStore, { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { expect, it, onTestFinished } from 'vitest'
import { diagnosticProjection } from '../../src/projection.ts'

async function fixture(maxOccurrencesPerSession = 10) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const definition = diagnosticProjection({ maxOccurrencesPerSession, maxDetailChars: 256 })
  const handle = await ctx.sessionProjections.register(definition)
  const session = ctx.sessions.create(SessionId('diagnosed'))
  const events: SessionEvent[] = []
  ctx.on('session/event', (owner, event) => { if (owner === session) events.push(event) })
  let counter = 0
  function result(options: { code?: string; text?: string; meta?: JsonValue; name?: string } = {}) {
    const callId = ToolCallId(`call-${counter++}`)
    const call = session.append('tool/call', { turn: 1, step: counter, callId, name: options.name ?? 'bash', arguments: '{"secret":"never-copy-arguments"}' })
    return session.append('tool/result', {
      turn: 1, step: counter,
      message: createToolResultMessage({ callId, content: [{ type: 'text', text: options.text ?? 'command failed' }], isError: options.code !== undefined }),
      ...(options.code === undefined ? {} : { error: { name: 'Error', code: options.code } }),
      ...(options.meta === undefined ? {} : { meta: options.meta }),
    }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  }
  const view = () => ctx.sessionProjections.snapshot(session, ['diagnostics']).values.diagnostics
  return { ctx, session, events, definition, handle, result, view }
}

function shell(extra: Record<string, JsonValue> = {}): JsonValue {
  return { cwd: '/Users/private/project', shellOutcome: { kind: 'foreground', exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 100, ...extra } }
}

it('records nonzero exits even when the tool message is not an error', async () => {
  const { result, view } = await fixture()
  result({ meta: shell({ exitCode: 60 }), text: 'process failed' })
  expect(view()?.records).toMatchObject([{ category: 'command', code: 'EXIT_60', source: 'bash', turn: 1 }])
})

it('uses a tool name for argument failures and never copies raw arguments', async () => {
  const { result, view } = await fixture()
  result({ code: 'INVALID_ARGS', name: 'todo_write', text: 'field is required' })
  expect(view()?.records).toMatchObject([{ category: 'arguments', source: 'todo_write', code: 'INVALID_ARGS' }])
  expect(JSON.stringify(view())).not.toContain('never-copy-arguments')
})

it('keeps successful calls and expected cancellations out of the error view', async () => {
  const { session, definition, handle, result, view } = await fixture()
  const before = definition.wire.view(handle.stateOf(session))
  result({ meta: shell() })
  result({ code: 'ABORTED' })
  result({ code: 'ABORTED_BEFORE_DISPATCH' })
  result({ meta: shell({ exitCode: null, signal: 'SIGTERM', stopped: 'user' }) })
  result({ meta: shell({ exitCode: null, aborted: true }) })
  expect(definition.wire.view(handle.stateOf(session))).toBe(before)
  expect(view()?.records).toEqual([])
})

it('classifies timeout, signal and sandbox denial from structured facts', async () => {
  const { result, view } = await fixture()
  result({ meta: shell({ timedOut: true }) })
  result({ meta: shell({ signal: 'SIGTERM', exitCode: null }) })
  result({ meta: shell({ sandbox: { mode: 'workspace-write', denied: true } }) })
  expect(view()?.records.map(row => [row.category, row.code])).toEqual([
    ['command', 'COMMAND_TIMEOUT'], ['command', 'SIGNAL_SIGTERM'], ['permission', 'SANDBOX_DENIED'],
  ])
})

it('does not infer exit facts from legacy rendered output', async () => {
  const { result, view } = await fixture()
  result({ text: '[exit code: 60]' })
  expect(view()?.records).toEqual([])
  result({ code: 'UNKNOWN', text: 'ordinary tool failure' })
  expect(view()?.records[0]?.category).toBe('tool')
})

it('retains newest bounded records and visibly counts omissions', async () => {
  const { result, view } = await fixture(2)
  result({ code: 'FIRST', text: 'first' })
  result({ code: 'SECOND', text: 'second' })
  result({ code: 'THIRD', text: 'password=private-value ' + 'x'.repeat(1000) })
  expect(view()?.records.map(row => row.code)).toEqual(['SECOND', 'THIRD'])
  expect(view()?.omitted).toBe(1)
  expect(view()?.records[1]?.details.length).toBeLessThanOrEqual(256)
  expect(JSON.stringify(view())).not.toContain('private-value')
})

it('records error turns but not completed or user-aborted turns', async () => {
  const { session, view } = await fixture()
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('turn/end', { turn: 2, reason: { kind: 'error', error: { message: 'provider failed', code: 'SERVER' } } })
  expect(view()?.records).toMatchObject([{ category: 'turn', code: 'SERVER', turn: 2 }])
})

it('replays the same view, excludes inherited failures and removes its key on disposal', async () => {
  const { ctx, session, events, definition, handle, result, view } = await fixture()
  result({ code: 'INVALID_ARGS', name: 'todo_write' })
  const restored = ctx.sessionProjections.restore({}, events, SessionLogOffset(0), session.header, SessionLogOffset(0))
  expect(restored.snapshot.values.diagnostics).toEqual(view())
  let inherited = definition.init(session.header, SessionLogOffset(events.length))
  for (const event of events) inherited = definition.apply(inherited, event)
  expect(definition.wire.view(inherited).records).toEqual([])
  await handle.dispose()
  expect(ctx.sessionProjections.snapshot(session).values.diagnostics).toBeUndefined()
})

it('records nested PTC command facts once without making a successful wrapper an error', async () => {
  const { session, view } = await fixture()
  const rootCallId = ToolCallId('root')
  const rootCall = session.append('tool/call', { turn: 3, step: 2, callId: rootCallId, name: 'run_code', arguments: '{}' })
  session.append('tool/ptc-dispatch', {
    rootCallId, parentCallId: rootCallId, subCallId: ToolCallId('sub'), name: 'bash', arguments: {},
    content: [{ type: 'text', text: 'nested failed' }], isError: false, meta: shell({ exitCode: 1 }),
  })
  session.append('tool/result', { turn: 3, step: 2, message: createToolResultMessage({ callId: rootCallId, content: [], isError: false }) }, { surfaceOp: 'append', sourceEventSeqs: [rootCall.seq] })
  expect(view()?.records).toMatchObject([{ category: 'command', source: 'bash', turn: 3, step: 2 }])
  expect(view()?.records).toHaveLength(1)
})
