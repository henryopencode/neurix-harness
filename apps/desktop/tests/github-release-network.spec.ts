/** Metadata retries stay bounded, release response bodies, and retain owner cancellation. */
import { afterEach, expect, it, vi } from 'vitest'
import { GithubReleaseNetworkError, readGithubReleaseText } from '../src/github-release-network.ts'
import type { GithubReleaseRequest } from '../src/github-release-transfer.ts'

afterEach(() => { vi.useRealTimers() })

function fixture() {
  const controller = new AbortController()
  const request = vi.fn<GithubReleaseRequest>(async () => new Response('complete'))
  const read = (maxBytes = 32, timeoutMs = 10_000, allowNotFound = false) => readGithubReleaseText({
    request, url: 'https://github.com/owner/repo/release', signal: controller.signal,
    timeoutMs, maxBytes, label: 'Metadata', allowNotFound,
  })
  return { controller, request, read }
}

it.each([408, 429, 500, 502, 503, 504])('recovers one HTTP %s response without exposing partial text', async (status) => {
  const f = fixture()
  const cancelled = vi.fn()
  f.request.mockResolvedValueOnce(new Response(new ReadableStream({ cancel: cancelled }), { status }))
  expect(await f.read()).toBe('complete')
  expect(f.request).toHaveBeenCalledTimes(2)
  expect(cancelled).toHaveBeenCalledOnce()
})

it('stops after three failed connections', async () => {
  const f = fixture()
  f.request.mockRejectedValue(new TypeError('connection reset'))
  await expect(f.read()).rejects.toThrow(GithubReleaseNetworkError)
  expect(f.request).toHaveBeenCalledTimes(3)
})

it('retries a broken response body from the beginning', async () => {
  const f = fixture()
  f.request.mockResolvedValueOnce(new Response(new ReadableStream({
    start(controller) { controller.error(new TypeError('body connection closed')) },
  })))
  expect(await f.read()).toBe('complete')
  expect(f.request).toHaveBeenCalledTimes(2)
})

it('rejects excess bytes immediately and releases the body without retrying', async () => {
  const f = fixture()
  const cancelled = vi.fn()
  f.request.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(Buffer.alloc(33)) }, cancel: cancelled,
  })))
  await expect(f.read()).rejects.toThrow('size limit')
  expect(f.request).toHaveBeenCalledTimes(1)
  expect(cancelled).toHaveBeenCalledOnce()
})

it('does not retry permanent refusals and preserves explicit empty-release handling', async () => {
  const f = fixture()
  f.request.mockResolvedValueOnce(new Response(null, { status: 403 }))
  await expect(f.read()).rejects.toThrow('HTTP 403')
  expect(f.request).toHaveBeenCalledTimes(1)
  f.request.mockResolvedValueOnce(new Response(null, { status: 404 }))
  expect(await f.read(32, 10_000, true)).toBeUndefined()
})

it('treats its own deadline as a network failure and awaits connection cancellation', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const started = Promise.withResolvers<undefined>()
  const closed = vi.fn()
  f.request.mockImplementationOnce(async (_url, { signal }) => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      signal.addEventListener('abort', () => { closed(); controller.error(signal.reason) }, { once: true })
      started.resolve(undefined)
    },
  })))
  const result = expect(f.read(32, 100)).rejects.toThrow(GithubReleaseNetworkError)
  await started.promise
  await vi.advanceTimersByTimeAsync(100)
  await result
  expect(closed).toHaveBeenCalledOnce()
  expect(f.request).toHaveBeenCalledTimes(1)
})

it('retains owner cancellation without waiting for or retrying a failed request', async () => {
  const f = fixture()
  const started = Promise.withResolvers<undefined>()
  f.request.mockImplementationOnce(async () => { started.resolve(undefined); return new Response(null, { status: 504 }) })
  const pending = f.read()
  await started.promise
  f.controller.abort(new Error('owner cancelled'))
  const error: unknown = await pending.catch((error: unknown) => error)
  expect(error).toBeInstanceOf(Error)
  expect(error).not.toBeInstanceOf(GithubReleaseNetworkError)
  expect(f.controller.signal.reason).toEqual(new Error('owner cancelled'))
  expect(f.request).toHaveBeenCalledTimes(1)
})

it('preserves a retry-deadline failure as eligible for the alternate route', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const started = Promise.withResolvers<undefined>()
  f.request.mockImplementationOnce(async () => { started.resolve(undefined); return new Response(null, { status: 504 }) })
  const result = expect(f.read(32, 100)).rejects.toThrow(GithubReleaseNetworkError)
  await started.promise
  await vi.advanceTimersByTimeAsync(100)
  await result
  expect(f.request).toHaveBeenCalledTimes(1)
})
