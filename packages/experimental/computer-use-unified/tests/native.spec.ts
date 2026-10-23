/** Native cancellation retains signal reasons and rejects late success. */

import { afterEach, expect, it, vi } from 'vitest'
import { ComputerError, NativeCalls, nativeActionResult } from '../src/native.ts'

afterEach(() => { vi.restoreAllMocks() })

it('rejects a canonical refused action even without the legacy error fields', async () => {
  const native = new NativeCalls({ async callTool() {
    return { rawJson: JSON.stringify({ content: [], structuredContent: {
      effect: 'refused', route: 'accessibility', error: { code: 'BACKGROUND_UNAVAILABLE', hint: 'Select foreground input.' },
    } }) }
  } }, 10_000)
  await expect(native.call('click', {}, new AbortController().signal)).rejects.toMatchObject({
    code: 'BACKGROUND_UNAVAILABLE', effect: 'none', message: 'Select foreground input.',
  })
})

it.each([
  { summary: 'No supported input route.', message: 'No supported input route.' },
  { summary: undefined, message: 'The driver refused input.' },
])('reports a readable canonical refusal without optional error details: $message', async ({ summary, message }) => {
  const native = new NativeCalls({ async callTool() {
    return { rawJson: JSON.stringify({ content: [], structuredContent: { effect: 'refused', route: 'accessibility', summary } }) }
  } }, 10_000)
  await expect(native.call('click', {}, new AbortController().signal)).rejects.toMatchObject({ code: 'DRIVER_REFUSED', effect: 'none', message })
})

it('preserves action evidence and rejects unknown effect discriminators', () => {
  const action = { effect: 'partial', route: 'synthetic_events', delivery: { mode: 'background', delivered_count: 1 },
    evidence: [{ kind: 'value_readback', detail: 'First character inserted.' }],
    escalation: { target: 'foreground', reason: 'effect_unconfirmed' }, summary: 'Partial insertion.' }
  expect(nativeActionResult({ content: [], structuredContent: action })).toEqual(action)
  expect(nativeActionResult(undefined)).toBeUndefined()
  expect(() => nativeActionResult({ content: [], structuredContent: { effect: 'new_unrecognized_effect' } })).toThrow()
})

it('preserves completed launch effects when readback is canceled', async () => {
  const controller = new AbortController()
  const failure = new ComputerError('OBSERVATION_FAILED', 'Launched; readback canceled', 'completed', 'List targets.')
  const native = new NativeCalls({ callTool: async () => {
    controller.abort(new Error('Stopped'))
    throw failure
  } }, 10_000)
  await expect(native.call('launch_app', {}, controller.signal)).rejects.toBe(failure)
})

it.each([
  { reason: new Error('User stopped the operation'), code: 'CANCELED' },
  { reason: new DOMException('Deadline expired', 'TimeoutError'), code: 'TIMEOUT' },
  { reason: 'host disposed', code: 'CANCELED' },
])('reports $code using the caller reason after native dispatch', async ({ reason, code }) => {
  const controller = new AbortController()
  const entered = Promise.withResolvers<undefined>()
  const native = new NativeCalls({ callTool: (_name, _args, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { reject(new Error('A Rust future was aborted')) }, { once: true })
    entered.resolve(undefined)
  }) }, 10_000)
  const operation = native.call('launch_app', {}, controller.signal)
  const failed = expect(operation).rejects.toMatchObject({ code, effect: 'possible', message: `launch_app: ${reason instanceof Error ? reason.message : reason}` })
  await entered.promise
  controller.abort(reason)
  await failed
})

it('reports the native deadline when the caller has not canceled', async () => {
  const deadline = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
  const entered = Promise.withResolvers<undefined>()
  const native = new NativeCalls({ callTool: (_name, _args, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { reject(new Error('A Rust future was aborted')) }, { once: true })
    entered.resolve(undefined)
  }) }, 10_000)
  const failed = expect(native.call('click', {}, new AbortController().signal)).rejects.toMatchObject({ code: 'TIMEOUT', effect: 'possible' })
  await entered.promise
  deadline.abort(new DOMException('Native deadline expired', 'TimeoutError'))
  await failed
})

it('does not accept late native success after cancellation and admits the next queued call', async () => {
  const controller = new AbortController()
  const entered = Promise.withResolvers<undefined>()
  const released = Promise.withResolvers<{ rawJson: string }>()
  let calls = 0
  const native = new NativeCalls({ callTool() { calls++; entered.resolve(undefined); return released.promise } }, 10_000)
  const failed = expect(native.call('click', {}, controller.signal)).rejects.toMatchObject({ code: 'CANCELED', effect: 'possible' })
  await entered.promise
  controller.abort(new Error('Session disposed'))
  const next = native.call('list_windows', {}, new AbortController().signal)
  expect(calls).toBe(1)
  released.resolve({ rawJson: '{"content":[]}' })
  await failed
  await expect(next).resolves.toEqual({ content: [] })
  expect(calls).toBe(2)
})

it('allows pixel-only capture during reserved input while leaving the next actionable call queued', async () => {
  const entered = Promise.withResolvers<undefined>(), released = Promise.withResolvers<undefined>()
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const native = new NativeCalls({ async callTool(name, json) {
    calls.push({ name, args: JSON.parse(json) as Record<string, unknown> })
    if (name === 'click') { entered.resolve(undefined); await released.promise }
    return { rawJson: '{"content":[]}' }
  } }, 10_000)
  const active = new AbortController().signal
  const input = native.call('click', {}, active)
  await entered.promise
  const next = native.call('list_windows', {}, active)
  await native.capture({ pid: 9, window_id: 7, session: 'live', max_dimension: 640 }, active, 1000)
  expect(calls.map(call => call.name)).toEqual(['click', 'get_window_state'])
  expect(calls[1]?.args).toMatchObject({ pid: 9, window_id: 7, display_only: true,
    include_screenshot: true, include_accessibility_tree: false })
  released.resolve(undefined)
  await input; await next
  expect(calls.map(call => call.name)).toEqual(['click', 'get_window_state', 'list_windows'])
})
