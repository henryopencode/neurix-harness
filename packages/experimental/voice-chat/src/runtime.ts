/** Verified model downloads and an isolated, managed MLX Python environment. */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, readFileSync } from 'node:fs'
import { access, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { z } from 'zod'
import type { Config } from './config.ts'
import type { VoiceModel } from './types.ts'

const assetSchema = z.object({ name: z.string(), url: z.url(), bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/) })
const manifestSchema = z.object({ uv: assetSchema, models: z.object({ 'mlx-4bit': z.array(assetSchema), 'mlx-8bit': z.array(assetSchema) }) })
const assets = manifestSchema.parse(JSON.parse(readFileSync(new URL('../runtime/assets.json', import.meta.url), 'utf8')))
const requirements = readFileSync(new URL('../runtime/requirements.txt', import.meta.url), 'utf8')
const runtimeVersion = createHash('sha256').update(requirements).digest('hex')

/** Managed runtime and checkpoint locations. */
export interface RuntimePaths { readonly python: string; readonly model: string }

/** Bounded parallel HTTP ranges used only when the origin advertises byte-range support. */
export interface DownloadOptions { readonly connections: number; readonly chunkBytes: number }

/**
 * Describe the pinned model download before the user prepares it.
 * @param model - selected local weight variant.
 * @returns aggregate checkpoint bytes, excluding Python and its dependencies.
 */
export function modelDownloadBytes(model: VoiceModel): number { return assets.models[model].reduce((sum, file) => sum + file.bytes, 0) }

async function matches(path: string, asset: z.infer<typeof assetSchema>, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted()
  const hash = createHash('sha256')
  let length = 0
  try {
    for await (const chunk of createReadStream(path, { signal })) { hash.update(chunk as Buffer); length += (chunk as Buffer).length }
    return length === asset.bytes && hash.digest('hex') === asset.sha256
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function downloadRanges(asset: z.infer<typeof assetSchema>, path: string, signal: AbortSignal,
  progress: (bytes: number) => void, options: DownloadOptions): Promise<void> {
  const file = await open(path, 'wx', 0o600), stopping = new AbortController()
  const lifetime = AbortSignal.any([signal, stopping.signal])
  let next = 0, total = 0
  const worker = async (): Promise<void> => {
    try {
      for (;;) {
        lifetime.throwIfAborted()
        const start = next
        next += options.chunkBytes
        if (start >= asset.bytes) return
        const end = Math.min(asset.bytes, start + options.chunkBytes) - 1
        const response = await fetch(asset.url, { headers: { Range: `bytes=${start}-${end}` }, signal: lifetime })
        if (response.status !== 206 || !response.body || response.headers.get('content-range') !== `bytes ${start}-${end}/${asset.bytes}`) {
          await response.body?.cancel()
          throw new Error('Voice asset returned an invalid HTTP byte range')
        }
        let length = 0
        for await (const chunk of response.body) {
          if (length + chunk.length > end - start + 1) throw new Error('Voice asset byte range exceeds its pinned length')
          let written = 0
          while (written < chunk.length) {
            const result = await file.write(chunk, written, chunk.length - written, start + length + written)
            if (result.bytesWritten === 0) throw new Error('Cannot write the voice asset byte range')
            written += result.bytesWritten
          }
          length += chunk.length; total += chunk.length; progress(total)
        }
        if (length !== end - start + 1) throw new Error('Voice asset byte range is incomplete')
      }
    } catch (error) { stopping.abort(error); throw error }
  }
  try {
    const results = await Promise.allSettled(Array.from({ length: options.connections }, () => worker()))
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    signal.throwIfAborted()
  } finally { await file.close() }
}

/**
 * Download and atomically publish one size- and checksum-pinned runtime asset.
 * @param asset - immutable upstream identity.
 * @param path - managed cache destination.
 * @param signal - preparation lifetime.
 * @param progress - cumulative bytes; a verified cache reports its complete length.
 * @param options - parallel transfer limits; origins without byte-range support use one bounded stream.
 * @returns after verification; failure removes only this operation's partial file.
 */
export async function downloadAsset(asset: z.infer<typeof assetSchema>, path: string, signal: AbortSignal,
  progress: (bytes: number) => void, options: DownloadOptions): Promise<void> {
  if (await matches(path, asset, signal)) { progress(asset.bytes); return }
  const partial = `${path}.${randomUUID()}.part`
  await mkdir(dirname(path), { recursive: true })
  try {
    const response = await fetch(asset.url, { signal })
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`Voice asset download returned HTTP ${response.status}`) }
    if (options.connections > 1 && asset.bytes > options.chunkBytes && response.headers.get('accept-ranges') === 'bytes') {
      await response.body.cancel()
      await downloadRanges(asset, partial, signal, progress, options)
      if (!await matches(partial, asset, signal)) throw new Error('Voice asset checksum mismatch')
    } else {
      const hash = createHash('sha256')
      let bytes = 0
      const hashing = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length
        if (bytes > asset.bytes) { callback(new Error('Voice asset exceeds its pinned byte length')); return }
        hash.update(chunk); progress(bytes); callback(null, chunk)
      } })
      await pipeline(response.body, hashing, createWriteStream(partial, { flags: 'wx', mode: 0o600 }), { signal })
      if (bytes !== asset.bytes || hash.digest('hex') !== asset.sha256) throw new Error('Voice asset checksum mismatch')
    }
    signal.throwIfAborted()
    await rename(partial, path)
  } finally { await rm(partial, { force: true }) }
}

function paths(root: string, model: VoiceModel): RuntimePaths {
  return { python: join(root, 'venv', 'bin', 'python'), model: join(root, 'models', model) }
}

/**
 * Inspect caches without starting Python, downloading, or changing files.
 * @param config - managed cache and model origin.
 * @param model - hardware-selected weight variant.
 * @param signal - inspection lifetime.
 * @returns complete runtime paths only after all checkpoint hashes match.
 */
export async function inspectRuntime(config: Config, model: VoiceModel, signal: AbortSignal): Promise<RuntimePaths | undefined> {
  const runtime = paths(config.dataRoot, model)
  try {
    if (await readFile(join(config.dataRoot, 'runtime-version'), 'utf8') !== runtimeVersion) return undefined
    await access(runtime.python)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  for (const asset of assets.models[model]) if (!await matches(join(runtime.model, asset.name), asset, signal)) return undefined
  return runtime
}

/**
 * Install a private Python runtime and download checksum-pinned Breeze weights on explicit preparation.
 * @param ctx - managed subprocess owner.
 * @param config - preparation settings and absolute cache directory.
 * @param model - validated hardware choice.
 * @param signal - cancellation or preparation deadline.
 * @param report - preparation progress; verified files survive cancellation.
 * @returns ready-to-load runtime and checkpoint paths.
 */
export async function prepareRuntime(ctx: Context, config: Config, model: VoiceModel, signal: AbortSignal,
  report: (operation: 'runtime' | 'model', completedBytes: number) => void): Promise<RuntimePaths> {
  const runtime = paths(config.dataRoot, model)
  const downloadOptions = { connections: config.downloadConnections, chunkBytes: config.downloadChunkBytes }
  await mkdir(config.dataRoot, { recursive: true })
  const run = async (argv: readonly string[]): Promise<void> => {
    const child = ctx.subprocess.spawn({ argv, cwd: config.dataRoot, graceMs: config.graceMs, signal,
      env: { UV_PYTHON_INSTALL_DIR: join(config.dataRoot, 'python'), UV_CACHE_DIR: join(config.dataRoot, 'cache'),
        UV_PYTHON_PREFERENCE: 'only-managed', UV_NO_PROGRESS: '1' },
      stdio: { stdin: 'ignore', stdout: { maxBytes: config.maxLogBytes }, stderr: { maxBytes: config.maxLogBytes } } })
    let result: SubprocessOutcome
    try { result = await child.done } finally { await child.waitForExit() }
    signal.throwIfAborted()
    if (result.exitCode !== 0 || result.signal !== null) throw new Error(`Voice runtime installation failed: ${child.collected.stderr?.readFrom(0).text}`)
  }
  report('runtime', 0)
  let installed = false
  try { await access(runtime.python); installed = await readFile(join(config.dataRoot, 'runtime-version'), 'utf8') === runtimeVersion }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  if (!installed) {
    const archive = join(config.dataRoot, assets.uv.name)
    await downloadAsset(assets.uv, archive, signal, () => {}, downloadOptions)
    await run(['/usr/bin/tar', '-xzf', archive, '-C', config.dataRoot])
    const uv = join(config.dataRoot, 'uv-aarch64-apple-darwin', 'uv')
    await run([uv, 'venv', '--allow-existing', '--python', '3.12.11', '--python-preference', 'only-managed', join(config.dataRoot, 'venv')])
    await run([uv, 'pip', 'install', '--python', runtime.python, '--requirement',
      fileURLToPath(new URL('../runtime/requirements.txt', import.meta.url))])
    await run([runtime.python, '-c', 'from mlx_audio.tts import load; import mlx.core'])
    signal.throwIfAborted()
    await writeFile(join(config.dataRoot, 'runtime-version'), runtimeVersion)
  }
  let completed = 0
  report('model', completed)
  for (const asset of assets.models[model]) {
    const url = new URL(asset.url)
    const origin = new URL(config.modelOrigin)
    url.protocol = origin.protocol; url.host = origin.host
    await downloadAsset({ ...asset, url: url.href }, join(runtime.model, asset.name), signal,
      (bytes) => { report('model', completed + bytes) }, downloadOptions)
    completed += asset.bytes
  }
  signal.throwIfAborted()
  return runtime
}
