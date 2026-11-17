/** Optional real Breeze inference verifies reusable voice references and the private streaming worker. */
import { spawn } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { Config } from '../src/config.ts'

const cache = process.env.DSH_VOICE_MODEL_CACHE

it.skipIf(!cache || process.platform !== 'darwin' || process.arch !== 'arm64')('streams different sentences with one unchanged reference per selected voice, including a worker restart', async () => {
  if (!cache) throw new Error('DSH_VOICE_MODEL_CACHE must contain a prepared Breeze runtime')
  const root = await mkdtemp(join(tmpdir(), 'dsh-voice-reference-'))
  const token = randomBytes(32).toString('hex')
  const config = { ...Config({ dataRoot: root }), model: join(cache, 'models', 'mlx-4bit') }
  const children: { child: ReturnType<typeof spawn>; closed: Promise<void> }[] = []
  onTestFinished(async () => {
    try {
      for (const { child, closed } of children) { child.kill(); await closed }
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  const start = async (overrides: Partial<ReturnType<typeof Config>> = {}): Promise<string> => {
    const child = spawn(join(cache, 'venv', 'bin', 'python'), ['-u', fileURLToPath(new URL('../runtime/worker.py', import.meta.url)), JSON.stringify({ ...config, ...overrides })], {
      env: { DSH_VOICE_TOKEN: token, HF_HUB_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const closed = Promise.withResolvers<undefined>()
    child.once('close', () => { closed.resolve(undefined) })
    children.push({ child, closed: closed.promise })
    const ready = Promise.withResolvers<string>(), lines = createInterface({ input: child.stdout })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4096) })
    child.on('error', ready.reject)
    child.once('exit', () => { ready.reject(new Error(`Voice worker exited before readiness: ${stderr}`)) })
    lines.once('line', (line) => {
      try {
        const value: unknown = JSON.parse(line)
        if (!value || typeof value !== 'object' || !('port' in value) || typeof value.port !== 'number'
          || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('Invalid voice worker readiness')
        ready.resolve(`http://127.0.0.1:${String(value.port)}`)
      } catch (error) { ready.reject(error) }
    })
    try { return await ready.promise } finally { lines.close(); child.stdout.resume() }
  }
  const request = async (url: string, voice: 'warm' | 'calm', text: string): Promise<void> => {
    const response = await fetch(`${url}/speech`, { method: 'POST', signal: AbortSignal.timeout(config.inferenceTimeoutMs),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ voice, text }) })
    expect(response.status).toBe(200)
    const audio = new Uint8Array(await response.arrayBuffer())
    expect(audio.length % 2).toBe(0)
    expect(audio.length).toBeGreaterThan(24000)
    expect(audio.some(value => value !== 0)).toBe(true)
  }
  const references = async (): Promise<string[]> => {
    const files = (await readdir(join(root, 'voices'))).sort()
    expect(files.every(file => file.endsWith('.wav'))).toBe(true)
    return await Promise.all(files.map(async file => createHash('sha256').update(await readFile(join(root, 'voices', file))).digest('hex')))
  }
  let url = await start()
  await request(url, 'warm', '你好，我们开始聊天吧。')
  const first = await references()
  expect(first).toHaveLength(1)
  await request(url, 'warm', '这是另一句话，也会使用同一份参考音色。')
  expect(await references()).toEqual(first)
  await request(url, 'calm', '你好，我们换一个声音继续聊天。')
  const selected = await references()
  expect(selected).toHaveLength(2)
  expect(new Set(selected).size).toBe(2)
  children[0]!.child.kill(); await children[0]!.closed
  url = await start()
  await request(url, 'warm', '重新启动后仍然使用保存的音色。')
  expect(await references()).toEqual(selected)
  children[1]!.child.kill(); await children[1]!.closed
  url = await start({ maxTokens: 50, referenceText: '你好。' })
  const truncated = await fetch(`${url}/speech`, { method: 'POST', signal: AbortSignal.timeout(config.inferenceTimeoutMs),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice: 'warm', text: '这是一段需要完整播放的长回答，我们会按顺序阅读每一句话，并检查模型达到输出上限时能否明确报告中断，避免把只说到一半的内容当作已经完成。' }) })
  expect(truncated.status).toBe(200)
  const completed = await truncated.arrayBuffer().then(() => true, () => false)
  expect(completed).toBe(false)
})
