/** Session-owned display capture admission and quiescent withdrawal. @module */

import type { Context, Plugin, Volatile } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ComputerPreviewCapture, ComputerPreviewFrame } from './types.ts'

interface PreviewPacing {
  previewIntervalMs: Volatile<number>
  previewActiveIntervalMs: Volatile<number>
  previewIdleIntervalMs: Volatile<number>
}
interface PreviewRemoteOptions {
  sources: ComputerPreviewSources
  refreshMs: (active: boolean, idle: boolean) => number
}

interface Source {
  capture: ComputerPreviewCapture
  lifetime: AbortController
  pending: Set<Promise<ComputerPreviewFrame>>
  current?: { promise: Promise<ComputerPreviewFrame>; lifetime: AbortController; readers: number }
}

/** Live capture functions remain owned by exact Agent activations. */
export class ComputerPreviewSources {
  /**
   * Attach one plugin's preview Remote and capture lifetime without starting a target.
   * @param ctx - source owner's context; teardown joins accepted captures.
   * @param remote - authenticated Remote with an independent namespace.
   * @param pacing - live settings for this plugin's preview carrier.
   * @returns this plugin's independently owned capture registry.
   */
  static mount(ctx: Context, remote: Plugin<PreviewRemoteOptions>, pacing: PreviewPacing): ComputerPreviewSources {
    const sources = new ComputerPreviewSources()
    ctx.effect(() => () => sources.dispose(), 'control-preview: display captures')
    ctx.inject(['typert'], async (child) => {
      await child.plugin(remote, { sources, refreshMs: (active, idle) => idle ? pacing.previewIdleIntervalMs.get()
        : active ? pacing.previewActiveIntervalMs.get() : pacing.previewIntervalMs.get() })
    })
    return sources
  }

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
