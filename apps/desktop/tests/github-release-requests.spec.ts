/** Updater network contexts stay bounded, cancellable, and owned by the Desktop lifetime. */
import type { Session } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { GithubReleaseRequests } from '../src/github-release-requests.ts'

vi.mock('electron', () => ({ session: { fromPartition: vi.fn() } }))
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

function fixture() {
  const sessions: Array<{ fetch: ReturnType<typeof vi.fn<Session['fetch']>>; closeAllConnections: ReturnType<typeof vi.fn<() => Promise<void>>> }> = []
  const requests = new GithubReleaseRequests(() => {
    const network = { fetch: vi.fn<Session['fetch']>(async () => new Response(null)), closeAllConnections: vi.fn(async () => {}) }
    sessions.push(network)
    return network
  })
  cleanups.push(async () => { await requests.dispose() })
  return { requests, sessions }
}

it('keeps repeated asset requests within eight private contexts and preserves range headers', async () => {
  const f = fixture()
  expect(f.sessions).toHaveLength(0)
  const signal = new AbortController().signal
  for (let index = 0; index < 24; index++) {
    await f.requests.request('https://example.invalid/asset', { signal, headers: { Range: 'bytes=0-1048575' } })
  }
  expect(f.sessions).toHaveLength(8)
  for (const network of f.sessions) {
    expect(network.fetch).toHaveBeenCalledTimes(3)
    expect(network.fetch.mock.calls.every(([, init]) => init?.headers !== undefined && new Headers(init.headers).get('Range') === 'bytes=0-1048575')).toBe(true)
  }
  await f.requests.dispose()
  expect(f.sessions.every(network => network.closeAllConnections.mock.calls.length === 1)).toBe(true)
})

it('retains caller cancellation and rejects new requests after disposal', async () => {
  const f = fixture()
  const controller = new AbortController()
  await f.requests.request('https://example.invalid/asset', { signal: controller.signal })
  const signal = f.sessions[0]!.fetch.mock.calls[0]![1]!.signal!
  expect(signal.aborted).toBe(false)
  controller.abort()
  expect(signal.aborted).toBe(true)
  await f.requests.dispose()
  await expect(f.requests.request('https://example.invalid/asset', { signal: new AbortController().signal })).rejects.toThrow()
  expect(f.sessions).toHaveLength(1)
})

it('waits for every context to close even when another closure fails', async () => {
  const f = fixture()
  for (let index = 0; index < 2; index++) await f.requests.request('https://example.invalid/asset', { signal: new AbortController().signal })
  f.sessions[0]!.closeAllConnections.mockRejectedValue(new Error('close failed'))
  const pending = Promise.withResolvers<undefined>()
  f.sessions[1]!.closeAllConnections.mockImplementation(() => pending.promise)
  const settled = vi.fn()
  const closing = f.requests.dispose().then(settled, settled)
  await Promise.resolve()
  await Promise.resolve()
  expect(settled).not.toHaveBeenCalled()
  pending.resolve(undefined)
  await closing
  expect(settled).toHaveBeenCalledWith(expect.any(AggregateError))
  f.sessions[0]!.closeAllConnections.mockResolvedValue(undefined)
})
