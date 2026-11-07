/** Composer execution ownership, activity publication, and effect cleanup. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ConversationStopRegistry, type ConversationStopProvider } from '../src/client/conversation/stop-registry.ts'

const id = 'group' as SessionId
const other = 'ordinary' as SessionId

function bench() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const registry = new ConversationStopRegistry(ctx)
  const active = createSnapshotStore(false)
  const off = vi.fn()
  const stop = vi.fn<ConversationStopProvider['stop']>().mockResolvedValue(undefined)
  const provider: ConversationStopProvider = {
    id: 'group', owns: sessionId => sessionId === id,
    active: () => active.getSnapshot(),
    subscribe: (listener) => {
      const unsubscribe = active.subscribe(listener)
      return () => { unsubscribe(); off() }
    },
    stop,
  }
  return { ctx, registry, active, provider, stop, off }
}

describe('composer stop providers', () => {
  it('publishes worker activity and leaves unrelated Sessions to ordinary cancellation', async () => {
    const { registry, active, provider, stop } = bench()
    const source = registry.activity(id)
    const notify = vi.fn()
    const unwatch = source.subscribe(notify)
    onTestFinished(unwatch)
    registry.register(provider)
    expect(notify).toHaveBeenCalledOnce()
    expect(source.getSnapshot()).toBe(false)
    active.set(true)
    expect(source.getSnapshot()).toBe(true)
    expect(registry.activity(other).getSnapshot()).toBe(false)
    expect(registry.cancel(other)).toBeUndefined()
    expect(stop).not.toHaveBeenCalled()
    await expect(registry.cancel(id)).resolves.toBeUndefined()
    expect(stop).toHaveBeenCalledWith(id)
    active.set(false)
    expect(source.getSnapshot()).toBe(false)
  })

  it('removes ownership, activity, and subscriptions with the contributing plugin', async () => {
    const { ctx, active, provider, off } = bench()
    active.set(true)
    let registry!: ConversationStopRegistry
    const fiber = ctx.plugin((scope) => {
      registry = new ConversationStopRegistry(scope)
      registry.register(provider)
    })
    await fiber.await()
    expect(registry.activity(id).getSnapshot()).toBe(true)
    await fiber.dispose()
    expect(off).toHaveBeenCalledOnce()
    expect(registry.activity(id).getSnapshot()).toBe(false)
    expect(registry.cancel(id)).toBeUndefined()
  })

  it('rejects duplicate IDs, ambiguous ownership, and stop failures', async () => {
    const { registry, provider, stop } = bench()
    expect(() => registry.register({ ...provider, id: '' })).toThrow('Invalid or duplicate')
    registry.register(provider)
    expect(() => registry.register(provider)).toThrow('Invalid or duplicate')
    const remove = registry.register({ ...provider, id: 'second' })
    await expect(registry.cancel(id)).rejects.toThrow('Multiple stop providers')
    expect(stop).not.toHaveBeenCalled()
    remove()
    stop.mockRejectedValueOnce(new Error('Stop failed'))
    await expect(registry.cancel(id)).rejects.toThrow('Stop failed')
  })
})
