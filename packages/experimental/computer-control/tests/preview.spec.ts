/** Display-only capture ownership, cancellation, and withdrawal. */

import { SessionId } from '@deepseek-ai/dsh-session'
import { expect, it } from 'vitest'
import { ComputerPreviewSources } from '../src/preview.ts'

it('reads only an existing exact Session and does not activate missing owners', async () => {
  const sources = new ComputerPreviewSources()
  const id = SessionId('preview-owner')
  let captured = 0
  const remove = sources.register(id, async () => { captured++; return { kind: 'idle' } })
  expect(await sources.capture(SessionId('another'), new AbortController().signal)).toEqual({ kind: 'idle' })
  expect(captured).toBe(0)
  expect(await sources.capture(id, new AbortController().signal)).toEqual({ kind: 'idle' })
  expect(captured).toBe(1)
  await remove()
  expect(await sources.capture(id, new AbortController().signal)).toEqual({ kind: 'idle' })
  await sources.dispose()
})

it('withdrawal cancels and awaits a capture before another owner can reuse the source', async () => {
  const sources = new ComputerPreviewSources()
  const id = SessionId('preview-owner')
  const entered = Promise.withResolvers<undefined>()
  const stopped = Promise.withResolvers<undefined>()
  const remove = sources.register(id, signal => new Promise((_resolve, reject) => {
    entered.resolve(undefined)
    signal.addEventListener('abort', () => {
      void stopped.promise.then(() => { reject(new Error('preview disposed')) })
    }, { once: true })
  }))
  const failed = expect(sources.capture(id, new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' })
  await entered.promise
  let disposed = false
  const closing = remove().then(() => { disposed = true })
  await Promise.resolve()
  expect(disposed).toBe(false)
  stopped.resolve(undefined)
  await closing
  await failed
  expect(disposed).toBe(true)
  await sources.dispose()
})

it('pre-aborted viewing never dispatches a capture and duplicate registrations fail loudly', async () => {
  const sources = new ComputerPreviewSources()
  const id = SessionId('preview-owner')
  let captured = false
  sources.register(id, async () => { captured = true; return { kind: 'idle' } })
  expect(() => sources.register(id, async () => ({ kind: 'idle' }))).toThrow('already belongs')
  await expect(sources.capture(id, AbortSignal.abort(new Error('closed preview')))).rejects.toThrow('closed preview')
  expect(captured).toBe(false)
  await sources.dispose()
  expect(() => sources.register(id, async () => ({ kind: 'idle' }))).toThrow()
})

it('shares a capture across viewers while canceling only the departing viewer', async () => {
  const sources = new ComputerPreviewSources()
  const id = SessionId('shared-preview')
  const entered = Promise.withResolvers<AbortSignal>()
  const released = Promise.withResolvers<undefined>()
  let captures = 0
  sources.register(id, async (signal) => {
    captures++
    entered.resolve(signal)
    await released.promise
    return { kind: 'idle' }
  })
  const cancel = new AbortController()
  const first = expect(sources.capture(id, cancel.signal)).rejects.toThrow('viewer left')
  const active = await entered.promise
  const second = sources.capture(id, new AbortController().signal)
  try {
    cancel.abort(new Error('viewer left'))
    await first
    expect(active.aborted).toBe(false)
    expect(captures).toBe(1)
    released.resolve(undefined)
    expect(await second).toEqual({ kind: 'idle' })
  } finally { released.resolve(undefined); await sources.dispose() }
})

it('cancels and joins the capture when its last viewer leaves', async () => {
  const sources = new ComputerPreviewSources()
  const id = SessionId('last-preview-viewer')
  const entered = Promise.withResolvers<AbortSignal>()
  const stopped = Promise.withResolvers<undefined>()
  const aborted = Promise.withResolvers<undefined>()
  sources.register(id, async (signal) => {
    signal.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
    entered.resolve(signal)
    await stopped.promise
    signal.throwIfAborted()
    return { kind: 'idle' }
  })
  const cancel = new AbortController()
  const result = expect(sources.capture(id, cancel.signal)).rejects.toThrow('closed')
  const active = await entered.promise
  try {
    cancel.abort(new Error('closed'))
    await aborted.promise
    expect(active.aborted).toBe(true)
    stopped.resolve(undefined)
    await result
  } finally { stopped.resolve(undefined); await sources.dispose() }
})
