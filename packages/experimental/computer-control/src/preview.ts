/** Session-owned display-only capture registration and authenticated preview access. @module */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ComputerPreviewSnapshot } from './preview-types.ts'
import type { ComputerPreviewCapture, ComputerPreviewFrame } from '@deepseek-ai/dsh-experimental-computer-use-unified'

interface Source {
  capture: ComputerPreviewCapture
  lifetime: AbortController
  pending: Set<Promise<ComputerPreviewFrame>>
  current?: { promise: Promise<ComputerPreviewFrame>; lifetime: AbortController; readers: number }
}

/** Live capture functions remain owned by exact Agent activations. */
export class ComputerPreviewSources {
  private readonly sources = new Map<SessionId, Source>()
  private readonly lifetime = new AbortController()

  /**
   * Register one Agent's capture and return quiescent withdrawal.
   * @param sessionId - owning Session identity.
   * @param capture - exact Agent's display-only capture.
   * @returns disposer canceling and joining all accepted preview requests.
   */
  register(sessionId: SessionId, capture: ComputerPreviewCapture): () => Promise<void> {
    this.lifetime.signal.throwIfAborted()
    if (this.sources.has(sessionId)) throw new Error('A computer preview already belongs to this Session')
    const source: Source = { capture, lifetime: new AbortController(), pending: new Set() }
    this.sources.set(sessionId, source)
    return async () => {
      if (this.sources.get(sessionId) === source) this.sources.delete(sessionId)
      source.lifetime.abort()
      await Promise.allSettled(source.pending)
    }
  }

  /**
   * Read an existing activation without starting an Agent or opening a window.
   * @param sessionId - Session currently displayed by the Client.
   * @param signal - Client cancellation and Remote lifetime.
   * @returns the current display-only capture, or idle for an inactive owner.
   */
  async capture(sessionId: SessionId, signal: AbortSignal): Promise<ComputerPreviewFrame> {
    signal.throwIfAborted()
    const source = this.sources.get(sessionId)
    if (source === undefined) return { kind: 'idle' }
    const viewing = AbortSignal.any([signal, source.lifetime.signal, this.lifetime.signal])
    if (source.current === undefined || source.current.lifetime.signal.aborted) {
      const lifetime = new AbortController()
      const active = AbortSignal.any([lifetime.signal, source.lifetime.signal, this.lifetime.signal])
      const promise = Promise.resolve().then(() => { active.throwIfAborted(); return source.capture(active) })
      const current = source.current = { promise, lifetime, readers: 0 }
      source.pending.add(promise)
      void promise.finally(() => {
        source.pending.delete(promise)
        if (source.current === current) delete source.current
      }).catch(() => {})
    }
    const current = source.current
    current.readers++
    const canceled = Promise.withResolvers<never>()
    const abort = () => { canceled.reject(viewing.reason) }
    viewing.addEventListener('abort', abort, { once: true })
    try {
      viewing.throwIfAborted()
      const frame = await Promise.race([current.promise, canceled.promise])
      viewing.throwIfAborted()
      return frame
    } finally {
      viewing.removeEventListener('abort', abort)
      if (--current.readers === 0) {
        current.lifetime.abort()
        await Promise.allSettled([current.promise])
      }
    }
  }

  /** Stop preview admission and join every display-only capture. */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    const sources = [...this.sources.values()]
    this.sources.clear()
    for (const source of sources) source.lifetime.abort()
    await Promise.allSettled(sources.flatMap(source => [...source.pending]))
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Display-only computer capture Remote. */
    computerPreview: ComputerPreviewController
  }
}

/** Read-only Remote for images from the currently selected Session's target. */
export class ComputerPreviewController extends TypertRemoteService {
  static inject = ['typert']

  /**
   * @param ctx - context with the authenticated Remote registry.
   * @param options - captured sources and validated refresh setting.
   */
  constructor(ctx: Context, private readonly options: {
    sources: ComputerPreviewSources
    refreshMs: (active: boolean, idle: boolean) => number
  }) {
    super(ctx, 'computerPreview', { namespace: 'computerPreview' })
  }

  /**
   * Capture only the existing target; never send mouse or keyboard input.
   * @param sessionId - displayed Session identity.
   * @param signal - browser cancellation or Remote withdrawal.
   * @returns a bounded preview and the Host-owned refresh interval.
   */
  @Remote
  async frame(sessionId: SessionId, signal: AbortSignal): Promise<ComputerPreviewSnapshot> {
    const frame = await this.options.sources.capture(sessionId, signal)
    return { frame, refreshMs: this.options.refreshMs(frame.kind === 'frame' && frame.active, frame.kind === 'idle') }
  }
}
