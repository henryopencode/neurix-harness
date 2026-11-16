/** The Host serializes model work, preserves streaming framing, and joins cancelled workers. */
import { createServer } from 'node:http'
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SubprocessRuntime, type SubprocessHandle, type SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { VoiceStatus } from '../src/types.ts'

const runtime = vi.hoisted(() => ({ inspect: vi.fn(), prepare: vi.fn() }))
vi.mock('../src/runtime.ts', () => ({ inspectRuntime: runtime.inspect, prepareRuntime: runtime.prepare, modelDownloadBytes: () => 3_000_000_000, RuntimePreparationError: class extends Error {} }))
vi.mock('../src/hardware.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/hardware.ts')>(),
  localHardware: () => ({ platform: 'darwin', architecture: 'arm64', memoryBytes: 16 * 1024 ** 3 }),
  nativeHardware: async (_ctx: Context, hardware: object) => hardware,
}))
import VoiceChat from '../src/index.ts'

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = []
  for await (const value of source) items.push(value)
  return items
}

async function fixture(body = Buffer.from([0, 0, 1, 0]), startup: Promise<unknown> = Promise.resolve()) {
  const server = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'application/octet-stream' }); response.end(body) })
  onTestFinished(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => { server.close(() => { resolve() }) }) })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing allocated model port')
  const children: { terminate: ReturnType<typeof vi.fn>; join: ReturnType<typeof vi.fn> }[] = []
  const spawn = vi.fn(() => {
    const stdout = new PassThrough(), closed = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
    const terminate = vi.fn(() => { closed.resolve({ exitCode: null, signal: 'SIGTERM' }) })
    const join = vi.fn(async () => { await closed.promise; return true })
    children.push({ terminate, join })
    void startup.then(() => { stdout.write(JSON.stringify({ port: address.port }) + '\n') })
    return { stdin: undefined, stdout, stderr: undefined, control: undefined,
      done: closed.promise, terminate, waitForExit: join, collected: {} } satisfies SubprocessHandle
  })
  const ctx = new Context()
  class ModelProcesses extends SubprocessRuntime {
    spawn(_spec: SubprocessSpawnSpec): SubprocessHandle { return spawn() }
    async resolveExecutable(): Promise<string> { throw new Error('Model test never resolves an executable') }
    async terminalEnvironment(): Promise<never> { throw new Error('Model test never opens a terminal') }
    async spawnTerminal(): Promise<never> { throw new Error('Model test never opens a terminal') }
  }
  new ModelProcesses(ctx)
  onTestFinished(async () => { await ctx.fiber.dispose() })
  runtime.inspect.mockResolvedValue({ python: '/private/managed/python', model: '/private/managed/model', worker: '/private/managed/worker.py' })
  runtime.prepare.mockResolvedValue({ python: '/private/managed/python', model: '/private/managed/model', worker: '/private/managed/worker.py' })
  const api = new VoiceChat(ctx, VoiceChat.Config({ dataRoot: '/private/voice-cache', idleTimeoutMs: 0 }))
  const observer = new AbortController()
  let state: VoiceStatus | undefined
  const following = (async () => { for await (const value of api.follow(observer.signal)) state = value })()
  onTestFinished(async () => { observer.abort(); await following })
  await vi.waitFor(() => { expect(state?.phase).toBe('ready') })
  return { api, ctx, spawn, children, state: () => state }
}

it('restores a verified cache without downloading or spawning and streams mono PCM', async () => {
  const b = await fixture()
  expect(b.spawn).not.toHaveBeenCalled()
  const audio = await collect(b.api.synthesize('你好。', new AbortController().signal))
  expect(Buffer.concat(audio.map(item => Buffer.from(item.pcmBase64, 'base64')))).toEqual(Buffer.from([0, 0, 1, 0]))
  expect(audio.every(item => item.sampleRate === 24000)).toBe(true)
  expect(b.spawn).toHaveBeenCalledTimes(1)
  await collect(b.api.synthesize('下一句。', new AbortController().signal))
  expect(b.spawn).toHaveBeenCalledTimes(1)
})

it('rejects truncated samples and joins worker termination before a retry', async () => {
  const b = await fixture(Buffer.from([1, 0, 2]))
  await expect(collect(b.api.synthesize('你好。', new AbortController().signal))).rejects.toMatchObject({ code: 'voice-chat/failed' })
  expect(b.children[0]?.terminate).toHaveBeenCalledOnce()
  expect(b.children[0]?.join).toHaveBeenCalledOnce()
  await expect(collect(b.api.synthesize('再试一次。', new AbortController().signal))).rejects.toMatchObject({ code: 'voice-chat/failed' })
  expect(b.spawn).toHaveBeenCalledTimes(2)
})

it('refuses empty, oversized and pre-cancelled requests before starting a worker', async () => {
  const b = await fixture()
  for (const text of ['', ' '.repeat(2), '字'.repeat(161)]) {
    await expect(collect(b.api.synthesize(text, new AbortController().signal))).rejects.toMatchObject({ details: { reason: 'invalid-text' } })
  }
  await expect(collect(b.api.synthesize('你好。', AbortSignal.abort(new Error('cancel'))))).rejects.toThrow('cancel')
  expect(b.spawn).not.toHaveBeenCalled()
})

it('releases a worker when a consumer closes a partially read stream', async () => {
  const b = await fixture()
  const audio = b.api.synthesize('你好。', new AbortController().signal)[Symbol.asyncIterator]()
  expect((await audio.next()).done).toBe(false)
  await audio.return?.()
  expect(b.children[0]?.terminate).toHaveBeenCalledOnce()
  expect(b.children[0]?.join).toHaveBeenCalledOnce()
})

it('joins model startup before releasing its subprocess provider on disposal', async () => {
  const ready = Promise.withResolvers<undefined>(), b = await fixture(undefined, ready.promise)
  const stream = b.api.synthesize('你好。', new AbortController().signal)[Symbol.asyncIterator]()
  const result = stream.next().then(() => ({ completed: true }), () => ({ completed: false }))
  await vi.waitFor(() => { expect(b.spawn).toHaveBeenCalledOnce() })
  await b.ctx.fiber.dispose()
  expect(await result).toEqual({ completed: false })
  expect(b.children[0]?.terminate).toHaveBeenCalledOnce()
  expect(b.children[0]?.join).toHaveBeenCalledOnce()
  ready.resolve(undefined)
})
