/** Local SDK process ownership keeps native cancellation locks outside the Web event loop. @module */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { z } from 'zod'
import { ComputerError } from './native.ts'
import { nativeDriverWorker } from './native-driver-worker.ts'

const reply = z.union([
  z.object({ id: z.number().int().positive(), rawJson: z.string() }),
  z.object({ id: z.number().int().positive(), error: z.string() }),
])
const sessionArgument = z.object({ session: z.string().optional() })

interface DriverProcess {
  child: ChildProcess
  exited: Promise<void>
  stopping: boolean
  failure?: Error
  pending: Map<number, PromiseWithResolvers<{ rawJson: string }>>
}

/** SDK calls and awaited disposal supplied to the native operation queue. */
export interface NativeDriver {
  /**
   * @param name - SDK operation name.
   * @param argumentsJson - validated operation arguments.
   * @param options - operation cancellation; interruption kills the SDK process and does not replay input.
   * @returns raw SDK JSON after the operation completes, or after interrupted work has exited.
   */
  callTool(name: string, argumentsJson: string, options: { signal: AbortSignal }): Promise<{ rawJson: string }>
  /** @returns after the SDK process and its owned process group exit. */
  close(): Promise<void>
}

/** One restartable local SDK host; replaced processes invalidate their native sessions. */
export class NativeDriverProcess implements NativeDriver {
  private active: DriverProcess | undefined
  private readonly sessions = new Map<string, ChildProcess>()
  private nextId = 0
  private closed = false

  /** @param moduleUrl - resolved SDK module URL in the local installation. */
  constructor(private readonly moduleUrl: string) {}

  /**
   * @param name - SDK operation name.
   * @param argumentsJson - validated operation JSON.
   * @param options - caller deadline and cancellation.
   * @returns the SDK response; cancellation awaits process exit before rejecting.
   */
  async callTool(name: string, argumentsJson: string, options: { signal: AbortSignal }): Promise<{ rawJson: string }> {
    options.signal.throwIfAborted()
    if (this.active?.stopping) await this.active.exited
    options.signal.throwIfAborted()
    if (this.closed) throw new ComputerError('NATIVE_DRIVER_CLOSED', 'The native driver is closed.', 'none', 'Start a new computer-control activation.')
    const { session } = sessionArgument.parse(JSON.parse(argumentsJson))
    const owner = session === undefined ? undefined : this.sessions.get(session)
    if (owner !== undefined && owner !== this.active?.child) {
      if (session !== undefined) this.sessions.delete(session)
      if (name === 'end_session') return { rawJson: '{"content":[]}' }
      throw new ComputerError('session_ended', 'The native driver process was replaced; earlier element refs are invalid.', 'none',
        'Observe the exact target before continuing. Interrupted input was not replayed.')
    }
    if (name === 'end_session' && this.active === undefined) return { rawJson: '{"content":[]}' }
    const state = this.active ?? this.start()
    if (name === 'start_session' && session !== undefined) this.sessions.set(session, state.child)
    const id = ++this.nextId
    const done = Promise.withResolvers<{ rawJson: string }>()
    state.pending.set(id, done)
    const abort = () => { this.stop(state) }
    options.signal.addEventListener('abort', abort, { once: true })
    state.child.send({ id, name, argumentsJson }, (error) => { if (error !== null) this.stop(state, error) })
    try {
      const result = await done.promise
      if (state.stopping) await state.exited
      options.signal.throwIfAborted()
      if (name === 'end_session' && session !== undefined) this.sessions.delete(session)
      return result
    } finally { options.signal.removeEventListener('abort', abort) }
  }

  /** @returns after owned native work is stopped; no SDK cancellation runs on the caller's thread. */
  async close(): Promise<void> {
    this.closed = true
    const active = this.active
    if (active !== undefined) { this.stop(active); await active.exited }
    this.sessions.clear()
  }

  private start(): DriverProcess {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', nativeDriverWorker, this.moduleUrl], {
      env: { ...scrubbedParentEnv(), ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'], detached: process.platform !== 'win32',
    })
    const exited = Promise.withResolvers<void>()
    const state: DriverProcess = { child, exited: exited.promise, stopping: false, pending: new Map() }
    this.active = state
    let diagnostic = ''
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { diagnostic = (diagnostic + chunk).slice(-2000) })
    child.once('error', (error) => { this.stop(state, error) })
    child.on('message', (message: unknown) => {
      const parsed = reply.safeParse(message)
      if (!parsed.success) { this.stop(state, new Error('The native driver returned invalid IPC data.')); return }
      const pending = state.pending.get(parsed.data.id)
      if (pending === undefined) return
      state.pending.delete(parsed.data.id)
      if ('error' in parsed.data) pending.reject(new Error(parsed.data.error))
      else pending.resolve({ rawJson: parsed.data.rawJson })
    })
    child.once('close', () => {
      if (this.active === state) this.active = undefined
      for (const pending of state.pending.values()) pending.reject(state.failure ?? new Error(diagnostic || 'The native driver process stopped.'))
      state.pending.clear()
      exited.resolve()
    })
    return state
  }

  private stop(state: DriverProcess, error?: Error): void {
    if (error !== undefined) state.failure = error
    if (state.stopping) return
    state.stopping = true
    try {
      if (process.platform !== 'win32' && state.child.pid !== undefined) process.kill(-state.child.pid, 'SIGKILL')
      else state.child.kill('SIGKILL')
    } catch (failure) {
      // The process can exit between the cancellation signal and group termination.
      if (!z.object({ code: z.literal('ESRCH') }).safeParse(failure).success) throw failure
    }
  }
}

/** Independent SDK processes keep preview cancellation from interrupting actionable observations or input. */
export class IsolatedNativeDriver implements NativeDriver {
  private readonly input: NativeDriverProcess
  private readonly preview: NativeDriverProcess
  private previewSession = `preview-${randomUUID()}`

  /** @param moduleUrl - resolved local SDK module used by both owned processes. */
  constructor(moduleUrl: string) {
    this.input = new NativeDriverProcess(moduleUrl)
    this.preview = new NativeDriverProcess(moduleUrl)
  }

  /**
   * @param name - SDK operation.
   * @param argumentsJson - exact operation arguments.
   * @param options - deadline and cancellation for this read or input only.
   * @returns SDK JSON; interrupted preview reads never invalidate input refs.
   */
  async callTool(name: string, argumentsJson: string, options: { signal: AbortSignal }): Promise<{ rawJson: string }> {
    if (name !== 'get_window_state') return this.input.callTool(name, argumentsJson, options)
    const args = z.record(z.string(), z.unknown()).parse(JSON.parse(argumentsJson))
    if (args.display_only !== true) return this.input.callTool(name, argumentsJson, options)
    try { await this.startPreview(options) } catch (error) {
      if (!(error instanceof ComputerError) || error.code !== 'session_ended') throw error
      this.previewSession = `preview-${randomUUID()}`
      await this.startPreview(options)
    }
    return this.preview.callTool(name, JSON.stringify({ ...args, session: this.previewSession }), options)
  }

  /** @returns after both SDK process groups exit. */
  async close(): Promise<void> { await Promise.all([this.input.close(), this.preview.close()]) }

  private async startPreview(options: { signal: AbortSignal }): Promise<void> {
    const started = await this.preview.callTool('start_session', JSON.stringify({ session: this.previewSession }), options)
    const ended = z.object({ structuredContent: z.object({ refusal: z.object({ code: z.literal('session_ended') }) }) })
      .safeParse(JSON.parse(started.rawJson))
    if (ended.success) throw new ComputerError('session_ended', 'The preview session expired.', 'none', 'Renew the read-only preview session.')
  }
}

/**
 * Create local input and preview SDK hosts without starting either process.
 * @returns isolated native calls with awaited process cleanup.
 */
export function createNativeDriver(): NativeDriver {
  return new IsolatedNativeDriver(import.meta.resolve('@trycua/cua-driver'))
}
