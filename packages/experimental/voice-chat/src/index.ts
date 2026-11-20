/** Optional local speech synthesis with explicit preparation and cancellable streaming. */
import { randomBytes } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { z } from 'zod'
import { Config } from './config.ts'
import { localHardware, nativeHardware, selectModel } from './hardware.ts'
import { inspectRuntime, modelDownloadBytes, prepareRuntime, RuntimePreparationError, type RuntimePaths } from './runtime.ts'
import type { VoiceAudio, VoiceOptions, VoiceStatus, VoiceSynthesisRequest } from './types.ts'

export { Config } from './config.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { /** Optional Host-owned local voice runtime. */ voiceChat: VoiceChat }
}

interface Worker { readonly child: SubprocessHandle; readonly url: string; readonly token: string }
interface Preparation {
  readonly abort: AbortController
  readonly done: Promise<void>
  readonly downloading: boolean
  downloadRequested: boolean
}

async function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  const cancelled = Promise.withResolvers<never>()
  const abort = (): void => { cancelled.reject(signal.reason) }
  signal.addEventListener('abort', abort, { once: true })
  try { return await Promise.race([promise, cancelled.promise]) }
  finally { signal.removeEventListener('abort', abort) }
}

/** Owns one model worker; downloads and Python installation require prepare(). */
export default class VoiceChat extends TypertRemoteService {
  static inject = ['subprocess', 'typert']
  static Config = Config
  private readonly lifetime = new AbortController()
  private readonly listeners = new Set<() => void>()
  private readonly owned: {
    status: VoiceStatus
    paths?: RuntimePaths
    preparation?: Preparation
    worker?: Worker
    starting?: Promise<Worker>
    stopping?: Promise<void>
    idle?: ReturnType<typeof setTimeout>
    pending: number
    tail: Promise<void>
  }

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'voiceChat', { namespace: 'voiceChat' })
    if (!isAbsolute(config.dataRoot)) throw new Error('Voice chat dataRoot must be absolute')
    const hardware = localHardware(), model = selectModel(hardware, config.model)
    this.owned = { pending: 0, tail: Promise.resolve(), status: { phase: model === null ? 'unsupported' : 'unprepared', model, hardware,
      downloadBytes: model === null ? 0 : modelDownloadBytes(model), completedBytes: 0, operation: null } }
    ctx.effect(() => {
      const inspection = nativeHardware(ctx, hardware, this.lifetime.signal, config.graceMs).then((native) => {
        if (this.lifetime.signal.aborted) return
        const selected = selectModel(native, config.model)
        this.publish({ hardware: native, model: selected, phase: selected === null ? 'unsupported' : 'unprepared',
          downloadBytes: selected === null ? 0 : modelDownloadBytes(selected) })
        if (selected !== null) this.beginPreparation(false)
      }).catch((error: unknown) => {
        if (!this.lifetime.signal.aborted) { ctx.logger.warn('Voice hardware detection failed', error); this.publish({ phase: 'failed', error: 'runtime' }) }
      })
      return async () => {
        this.lifetime.abort()
        clearTimeout(this.owned.idle)
        await inspection
        this.owned.preparation?.abort.abort()
        for (const listener of this.listeners) listener()
        await this.owned.preparation?.done
        try { await this.owned.starting } catch (_error) {
          // The preparation task or synthesis request owns the startup failure report.
        }
        await this.stopWorker()
      }
    })
  }

  /**
   * Observe hardware selection and preparation without starting downloads.
   * @param signal - browser observation lifetime, independent of the preparation task.
   * @returns complete initial and subsequent coalesced states.
   */
  @Remote({ mode: 'stream' })
  async *follow(signal: AbortSignal): AsyncIterable<VoiceStatus> {
    const lifetime = AbortSignal.any([signal, this.lifetime.signal])
    while (!lifetime.aborted) {
      const wake = Promise.withResolvers<void>()
      const changed = (): void => { wake.resolve() }
      this.listeners.add(changed); lifetime.addEventListener('abort', changed, { once: true })
      try { yield this.owned.status; await wake.promise }
      finally { this.listeners.delete(changed); lifetime.removeEventListener('abort', changed) }
    }
  }

  /**
   * Read the deployment's voice interaction limits.
   * @returns capture, submission, and playback options without activating the microphone or model.
   */
  @Remote
  options(): VoiceOptions {
    const { speechThreshold, silenceMs, minimumSpeechMs, preRollMs, maxUtteranceSeconds, maxPendingUtterances,
      maxSentenceCharacters, maxPendingSentences, warmupText, voice, playbackBufferMs, playbackResumeTimeoutMs } = this.config
    return { speechThreshold, silenceMs, minimumSpeechMs, preRollMs, maxUtteranceSeconds,
      maxPendingUtterances, maxSentenceCharacters, maxPendingSentences, warmupText, voice, playbackBufferMs, playbackResumeTimeoutMs }
  }

  /** Start or join explicit local runtime and model preparation; failures appear in follow(). */
  @Remote
  prepare(): void { this.lifetime.signal.throwIfAborted(); this.beginPreparation(true) }

  /**
   * Cancel preparation and join its cleanup; verified files remain reusable.
   * @returns after the shared preparation settles.
   */
  @Remote
  async cancelPreparation(): Promise<void> {
    const current = this.owned.preparation
    current?.abort.abort()
    await current?.done
  }

  /**
   * Speak one bounded plain-text segment with the prepared local model.
   * @param request - bounded visible text with an explicit voice; a string uses the deployment's default voice.
   * @param signal - playback cancellation; stopping inference reclaims and joins the worker.
   * @returns mono 24 kHz PCM16 fragments. Partial failures reject and never report success.
   */
  @Remote({ mode: 'stream' })
  async *synthesize(request: string | VoiceSynthesisRequest, signal: AbortSignal): AsyncIterable<VoiceAudio> {
    const caller = AbortSignal.any([signal, this.lifetime.signal])
    caller.throwIfAborted()
    const { text, voice } = typeof request === 'string' ? { text: request, voice: this.config.voice } : request
    if (text.trim() === '' || text.length > this.config.maxSentenceCharacters) throw this.failure('invalid-text')
    if (this.owned.status.phase !== 'ready' || !this.owned.paths) throw this.failure('not-ready')
    if (this.owned.pending >= this.config.maxPendingSyntheses) throw this.failure('busy')
    clearTimeout(this.owned.idle)
    const previous = this.owned.tail, finished = Promise.withResolvers<void>()
    this.owned.tail = previous.then(() => finished.promise)
    this.owned.pending++
    let completed = false, acquired = false
    try {
      using work = deadline(caller, this.config.inferenceTimeoutMs, 'VOICE_INFERENCE_TIMEOUT')
      await waitFor(previous, work.signal)
      acquired = true
      const worker = await this.startWorker(work.signal)
      const response = await fetch(`${worker.url}/speech`, { method: 'POST', signal: work.signal,
        headers: { Authorization: `Bearer ${worker.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice }) })
      if (!response.ok || !response.body) { await response.body?.cancel(); throw this.failure('inference') }
      const reader = response.body.getReader()
      let bytes = 0, remainder = new Uint8Array(0)
      try {
        for (;;) {
          const { value, done } = await reader.read()
          work.signal.throwIfAborted()
          if (done) break
          bytes += value.length
          if (bytes > this.config.maxAudioBytes) throw this.failure('inference')
          const data = Buffer.concat([remainder, value])
          const end = data.length - data.length % 2
          remainder = data.subarray(end)
          if (end > 0) yield { pcmBase64: data.subarray(0, end).toString('base64'), sampleRate: 24000 }
        }
        if (bytes === 0 || remainder.length !== 0) throw this.failure('inference')
        completed = true
      } finally { await reader.cancel(); reader.releaseLock() }
    } catch (error) {
      caller.throwIfAborted()
      this.ctx.logger.warn('Local voice synthesis failed', error)
      throw this.failure('inference')
    } finally {
      try { if (acquired && !completed) await this.stopWorker() }
      finally { this.owned.pending--; finished.resolve(); this.scheduleIdle() }
    }
  }

  private failure(reason: 'not-ready' | 'busy' | 'inference' | 'invalid-text'): RemoteError<'voice-chat/failed'> {
    return new RemoteError('voice-chat/failed', 'Local speech synthesis is unavailable', { reason })
  }

  private publish(patch: Partial<VoiceStatus>): void {
    this.owned.status = { ...this.owned.status, ...patch }
    for (const listener of this.listeners) listener()
  }

  private beginPreparation(download: boolean): void {
    if (this.owned.preparation) {
      if (download && !this.owned.preparation.downloading) this.owned.preparation.downloadRequested = true
      return
    }
    if (this.owned.status.model === null || this.lifetime.signal.aborted || download && this.owned.status.phase === 'ready') return
    const abort = new AbortController(), done = Promise.withResolvers<void>()
    const task: Preparation = { abort, done: done.promise, downloading: download, downloadRequested: false }
    this.owned.preparation = task
    const run = async (): Promise<void> => {
      using work = deadline(AbortSignal.any([abort.signal, this.lifetime.signal]), this.config.prepareTimeoutMs, 'VOICE_PREPARE_TIMEOUT')
      const model = this.owned.status.model
      if (model === null) return
      if (download) this.publish({ phase: 'preparing', operation: 'runtime', error: undefined, failedStep: undefined })
      try {
        const paths = download ? await prepareRuntime(this.ctx, this.config, model, work.signal, (operation, completedBytes) => {
          this.publish({ operation, completedBytes })
        }) : await inspectRuntime(this.config, model, work.signal)
        work.signal.throwIfAborted()
        if (paths) this.owned.paths = paths
        if (paths && download) { this.publish({ operation: 'loading' }); await this.startWorker(work.signal) }
        this.publish({ phase: paths ? 'ready' : 'unprepared', operation: null, error: undefined })
        this.scheduleIdle()
      } catch (error) {
        await this.stopWorker()
        if (!work.signal.aborted) this.ctx.logger.warn('Local voice preparation failed', error)
        this.publish({ phase: abort.signal.aborted ? 'unprepared' : 'failed', operation: null,
          error: abort.signal.aborted ? undefined : this.owned.status.operation === 'model' ? 'download' : 'runtime',
          failedStep: abort.signal.aborted ? undefined : error instanceof RuntimePreparationError ? error.step : 'loading' })
      } finally {
        if (this.owned.preparation === task) delete this.owned.preparation
        done.resolve()
        if (task.downloadRequested && !abort.signal.aborted) this.beginPreparation(true)
      }
    }
    void run()
  }

  private async startWorker(signal: AbortSignal): Promise<Worker> {
    if (this.owned.starting) return await waitFor(this.owned.starting, signal)
    const starting = this.launchWorker(signal)
    this.owned.starting = starting
    try { return await starting }
    finally { if (this.owned.starting === starting) delete this.owned.starting }
  }

  private async launchWorker(signal: AbortSignal): Promise<Worker> {
    await this.owned.stopping
    signal.throwIfAborted()
    if (this.owned.worker) return this.owned.worker
    const runtime = this.owned.paths
    if (!runtime) throw this.failure('not-ready')
    const token = randomBytes(32).toString('hex')
    const child = this.ctx.subprocess.spawn({
      argv: [runtime.python, '-u', runtime.worker,
        JSON.stringify({ ...this.config, model: runtime.model })],
      cwd: this.config.dataRoot, graceMs: this.config.graceMs,
      env: { DSH_VOICE_TOKEN: token, HF_HUB_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false' },
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: this.config.maxLogBytes } },
    })
    const ready = Promise.withResolvers<number>()
    let buffer = ''
    const receive = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8')
      if (Buffer.byteLength(buffer) > this.config.maxLogBytes) { ready.reject(new Error('Voice worker readiness exceeds its byte limit')); return }
      const line = buffer.indexOf('\n')
      if (line < 0) return
      try { ready.resolve(z.object({ port: z.number().int().min(1).max(65535) }).strict().parse(JSON.parse(buffer.slice(0, line))).port) }
      catch (error) { ready.reject(error) }
    }
    const cancel = (): void => { ready.reject(signal.reason) }
    const exited = (): void => { ready.reject(new Error(`Voice worker exited: ${child.collected.stderr?.readFrom(0).text}`)) }
    child.stdout?.on('data', receive)
    signal.addEventListener('abort', cancel, { once: true })
    void child.done.then(exited, ready.reject)
    try {
      signal.throwIfAborted()
      const port = await ready.promise
      signal.throwIfAborted()
      const worker = { child, url: `http://127.0.0.1:${port}`, token }
      this.owned.worker = worker
      void child.done.finally(() => { if (this.owned.worker === worker) delete this.owned.worker }).catch((error: unknown) => { this.ctx.logger.warn('Local voice worker failed', error) })
      return worker
    } catch (error) { child.terminate(); await child.waitForExit(); throw error }
    finally { signal.removeEventListener('abort', cancel); child.stdout?.off('data', receive); child.stdout?.resume() }
  }

  private async stopWorker(): Promise<void> {
    const worker = this.owned.worker
    if (!worker) { await this.owned.stopping; return }
    delete this.owned.worker
    worker.child.terminate()
    const stopping = worker.child.waitForExit().then(() => undefined)
    this.owned.stopping = stopping
    try { await stopping }
    finally { if (this.owned.stopping === stopping) delete this.owned.stopping }
  }

  private scheduleIdle(): void {
    clearTimeout(this.owned.idle)
    if (!this.owned.worker || this.owned.pending !== 0 || this.lifetime.signal.aborted || this.config.idleTimeoutMs === 0) return
    this.owned.idle = setTimeout(() => {
      void this.stopWorker().catch((error: unknown) => { this.ctx.logger.warn('Voice worker idle cleanup failed', error) })
    }, this.config.idleTimeoutMs)
  }
}
