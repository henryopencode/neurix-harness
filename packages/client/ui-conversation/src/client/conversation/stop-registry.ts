/** Plugin-owned execution activity and cancellation for the resident composer. */
import { Service, type Context } from '@deepseek-ai/cordis'
import { notifySubscribers, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One plugin's execution owner; ordinary Session cancellation remains the fallback. */
export interface ConversationStopProvider {
  /** Unique plugin contribution identifier. */
  readonly id: string
  /**
   * @param sessionId - Composer Session.
   * @returns Whether this provider owns its stop action.
   */
  owns(sessionId: SessionId): boolean
  /**
   * @param sessionId - Composer Session.
   * @returns Whether associated executions are active.
   */
  active(sessionId: SessionId): boolean
  /**
   * @param listener - Activity or ownership invalidation.
   * @returns Unsubscribe callback.
   */
  subscribe(listener: () => void): () => void
  /**
   * @param sessionId - Composer Session.
   * @returns Completion, rejecting on stop failure.
   */
  stop(sessionId: SessionId): Promise<void>
}

/** Effect-owned stop providers without copies of their execution state. */
export class ConversationStopRegistry {
  private readonly providers = new Map<string, ConversationStopProvider>()
  private readonly listeners = new Set<() => void>()

  /** @param ctx - Context whose effects own contributed providers. */
  constructor(private readonly ctx: Context) {
    Object.defineProperty(this, Service.tracker, { value: { property: 'ctx' } })
  }

  /**
   * Register execution activity and its cancellation action together.
   * @param provider - Uniquely named execution owner.
   * @returns Idempotent disposer; plugin disposal also removes its subscription.
   */
  register(provider: ConversationStopProvider): () => void {
    if (provider.id === '' || this.providers.has(provider.id)) throw new Error(`Invalid or duplicate stop provider: ${provider.id}`)
    const dispose = this.ctx.effect(() => {
      const unwatch = provider.subscribe(() => { this.notify() })
      this.providers.set(provider.id, provider)
      this.notify()
      return () => {
        unwatch()
        this.providers.delete(provider.id)
        this.notify()
      }
    }, `uiConversation.stops.register(${provider.id})`)
    return () => { void dispose() }
  }

  /**
   * Create an observable for one mounted composer's associated execution activity.
   * @param sessionId - Session rendered by the composer.
   * @returns Boolean source; registrations and provider changes invalidate subscribers.
   */
  activity(sessionId: SessionId): ObservableSnapshot<boolean> {
    return {
      getSnapshot: () => [...this.providers.values()].some(provider => provider.owns(sessionId) && provider.active(sessionId)),
      subscribe: (listener) => {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
    }
  }

  /**
   * Stop through the sole matching owner, leaving ordinary cancellation to the caller.
   * @param sessionId - Session whose Stop was activated.
   * @returns Stop completion, or undefined without an owner; rejects on ambiguous ownership or stop failure.
   */
  cancel(sessionId: SessionId): Promise<void> | undefined {
    const owners = [...this.providers.values()].filter(provider => provider.owns(sessionId))
    if (owners.length > 1) return Promise.reject(new Error(`Multiple stop providers own Session ${sessionId}`))
    const owner = owners[0]
    if (owner === undefined) return undefined
    return (async () => { await owner.stop(sessionId) })()
  }

  private notify(): void {
    notifySubscribers(this.listeners, '[ui-conversation] stop providers')
  }
}
