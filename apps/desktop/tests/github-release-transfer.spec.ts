/** Real positional cache writes with interrupted, invalid, and cancelled range responses. */
import { mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { transferGithubRelease, type GithubReleaseRequest } from '../src/github-release-transfer.ts'

const blockBytes = 1024 * 1024
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture(size = 3 * blockBytes + 17) {
  const directory = await mkdtemp(join(tmpdir(), 'neurix-range-transfer-'))
  cleanups.push(async () => { await rm(directory, { recursive: true, force: true }) })
  const path = join(directory, 'installer')
  const file = await open(path, 'wx', 0o600)
  const controller = new AbortController()
  let operation: Promise<void> | undefined
  cleanups.push(async () => {
    controller.abort()
    await operation?.catch(() => undefined)
    await file.close()
  })
  const bytes = Buffer.alloc(size)
  for (let index = 0; index < size; index++) bytes[index] = index % 251
  const ranges: Array<[number, number]> = []
  const request = vi.fn<GithubReleaseRequest>(async (_url, init) => {
    const match = /^bytes=(\d+)-(\d+)$/u.exec(init.headers?.Range ?? '')
    if (match === null) throw new Error('Expected an explicit byte range')
    const start = Number(match[1]), end = Number(match[2])
    ranges.push([start, end])
    return new Response(bytes.subarray(start, end + 1), { status: 206,
      headers: { 'Content-Range': `bytes ${start}-${end}/${size}` } })
  })
  const start = (): Promise<void> => {
    operation = transferGithubRelease({ url: 'https://example.invalid/installer', size, file, request,
      signal: controller.signal, idleTimeoutMs: 10_000, progress })
    return operation
  }
  const progress = vi.fn<(received: number) => void>()
  return { path, bytes, file, controller, request, ranges, progress, start }
}

it('assembles disjoint ranges in the cache and reports each written byte once', async () => {
  const f = await fixture()
  await f.start()
  expect((await readFile(f.path)).equals(f.bytes)).toBe(true)
  expect(f.ranges).toEqual([[0, blockBytes - 1], [blockBytes, 2 * blockBytes - 1],
    [2 * blockBytes, 3 * blockBytes - 1], [3 * blockBytes, f.bytes.length - 1]])
  const progress = f.progress.mock.calls.map(([received]) => received)
  expect(progress.at(-1)).toBe(f.bytes.length)
  expect(progress.every((received, index) => received > (progress[index - 1] ?? 0))).toBe(true)
})

it.each(['disconnect', 'truncated'] as const)('resumes written bytes after a %s response', async (failure) => {
  const f = await fixture()
  let pulled = false
  f.request.mockImplementationOnce(async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!pulled) { pulled = true; controller.enqueue(f.bytes.subarray(0, blockBytes / 2)); return }
      if (failure === 'disconnect') controller.error(new TypeError('net::ERR_HTTP2_PROTOCOL_ERROR'))
      else controller.close()
    },
  }), { status: 206, headers: { 'Content-Range': `bytes 0-${blockBytes - 1}/${f.bytes.length}` } }))
  await f.start()
  expect(f.ranges[0]).toEqual([blockBytes / 2, blockBytes - 1])
  expect((await readFile(f.path)).equals(f.bytes)).toBe(true)
  expect(f.progress.mock.calls.at(-1)).toEqual([f.bytes.length])
})

it('stops after three failed connections and leaves installation to the caller', async () => {
  const f = await fixture()
  f.request.mockRejectedValue(new TypeError('net::ERR_HTTP2_PROTOCOL_ERROR'))
  await expect(f.start()).rejects.toThrow('ERR_HTTP2_PROTOCOL_ERROR')
  expect(f.request).toHaveBeenCalledTimes(3)
  expect((await readFile(f.path)).length).toBe(0)
})

it('rejects mismatched range metadata without writing or retrying it', async () => {
  const f = await fixture()
  f.request.mockResolvedValue(new Response(f.bytes.subarray(0, blockBytes), { status: 206,
    headers: { 'Content-Range': `bytes 0-${blockBytes - 1}/${f.bytes.length + 1}` } }))
  await expect(f.start()).rejects.toThrow('range response is invalid')
  expect(f.request).toHaveBeenCalledTimes(1)
  expect((await readFile(f.path)).length).toBe(0)
})

it('settles all six parallel requests before cancellation completes', async () => {
  const f = await fixture(8 * blockBytes)
  const pending = Promise.withResolvers<undefined>()
  let active = 0, stopped = 0
  const original = f.request.getMockImplementation()!
  f.request.mockImplementation(async (url, init) => {
    if (init.headers?.Range === `bytes=0-${blockBytes - 1}`) return original(url, init)
    const match = /^bytes=(\d+)-(\d+)$/u.exec(init.headers?.Range ?? '')!
    active++
    if (active === 6) pending.resolve(undefined)
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        init.signal.addEventListener('abort', () => { stopped++; controller.error(init.signal.reason) }, { once: true })
      },
    }), { status: 206, headers: { 'Content-Range': `bytes ${match[1]}-${match[2]}/${f.bytes.length}` } })
  })
  const operation = f.start()
  await pending.promise
  const rejected = expect(operation).rejects.toThrow()
  f.controller.abort()
  await rejected
  expect(active).toBe(6)
  expect(stopped).toBe(6)
  expect(f.progress.mock.calls.at(-1)).toEqual([blockBytes])
})
