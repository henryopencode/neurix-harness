/** Shared preview source registration is independent and reversible. */

import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { installConnection } from '@deepseek-ai/dsh-client-connection/client'
import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import { ResourceRegistry } from '@deepseek-ai/dsh-client-resources/src/client/resources.ts'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSidebarRightController } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/service.ts'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import * as PreviewUi from '../src/client/index.ts'
import { browserCaptureAddress } from '../src/client/browser-capture-address.ts'
import { createPreviewUi } from '../src/client/preview-ui.ts'
import type { ComputerPreviewSnapshot } from '../src/types.ts'

function previewServices(ctx: Context) {
  ctx.provide('locale', new LocaleRuntime(ctx))
  const resources = new ResourceRegistry(ctx)
  const tabs = new SidebarRightTabRegistry(ctx)
  const sidebar = createSidebarRightController(tabs, () => {}, {
    autoFullscreen: () => false,
    openWithFocus: (_sessionId, open) => { open() },
    closeWithFocus: (_sessionId, _paneId, close) => { close() },
  })
  ctx.provide('resources', resources)
  ctx.provide('sidebarRightTabs', tabs)
  ctx.provide('sidebarRight', sidebar.controller)
  ctx.effect(() => () => { sidebar.controller.tabDomain.dispose() })
  return { resources, tabs, show: sidebar.show }
}

it('registers both sources after a late header declaration and withdraws each independently', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SlotRegistry)
    const { resources, tabs } = previewServices(ctx)
    installConnection(ctx)
    const fiber = ctx.plugin(PreviewUi)
    await fiber
    const slots = ctx.get('slots') as SlotRegistry
    const app = new Context()
    const browser = new Context()
    try {
      app.provide('slots', slots)
      browser.provide('slots', slots)
      const removeApp = ctx.computerPreviewUi.register(app, { surface: 'applications', loadPreview: async () => ({ frame: { kind: 'idle' }, refreshMs: 1000 }) })
      const removeBrowser = ctx.computerPreviewUi.register(browser, { surface: 'browser', loadPreview: async () => ({ frame: { kind: 'idle' }, refreshMs: 1000 }) })
      const capture = resources.source(browserCaptureAddress('test' as SessionId))
      expect(capture.getSnapshot().status).toBe('loading')
      expect(tabs.get('agent-browser')?.persist).toBe(false)
      expect(slots.entries('conversation.session.header.utilities')).toHaveLength(0)
      slots.register({ name: 'root', children: { 'conversation.session.header.utilities': { kind: 'append', scope: 'root' } } } as never, () => null)
      expect(slots.entries('conversation.session.header.utilities').map(entry => entry.options.id)).toEqual(['applications-control.preview', 'browser-control.preview'])
      await removeBrowser()
      expect(capture.getSnapshot().status).toBe('none')
      expect(tabs.get('agent-browser')).toBeUndefined()
      expect(slots.entries('conversation.session.header.utilities').map(entry => entry.options.id)).toEqual(['applications-control.preview'])
      await removeApp()
      expect(slots.entries('conversation.session.header.utilities')).toHaveLength(0)
    } finally { await browser.fiber.dispose(); await app.fiber.dispose() }
    await fiber.dispose()
    expect(ctx.get('computerPreviewUi')).toBeUndefined()
  } finally { await ctx.fiber.dispose() }
})

it('shares one read across both viewers and cancels it before switching Sessions, reconnecting or unloading', async () => {
  const ctx = new Context()
  const source = new Context()
  try {
    await ctx.plugin(SlotRegistry)
    source.provide('slots', ctx.slots)
    const { resources, show } = previewServices(ctx)
    let generation: ConnectionGeneration | undefined = { id: 1, host: { home: '/' } }
    const listeners = new Set<() => void>()
    const connect = (id?: number) => {
      generation = id === undefined ? undefined : { id, host: { home: '/' } }
      for (const notify of [...listeners]) notify()
    }
    const reads: Array<{ sessionId: SessionId; signal: AbortSignal }> = []
    const loadPreview = (sessionId: SessionId, signal: AbortSignal) => {
      const pending = Promise.withResolvers<ComputerPreviewSnapshot>()
      reads.push({ sessionId, signal })
      signal.addEventListener('abort', () => { pending.reject(signal.reason) }, { once: true })
      return pending.promise
    }
    const remove = createPreviewUi(ctx, {
      getSnapshot: () => generation,
      subscribe: (notify) => { listeners.add(notify); return () => { listeners.delete(notify) } },
    }).register(source, { surface: 'browser', loadPreview })
    const sessionId = 'session' as SessionId
    const address = browserCaptureAddress(sessionId)
    show(sessionId)
    const picture = resources.source(address).subscribe(() => {})
    const sidebar = new AbortController()
    resources.pin(address, sidebar.signal)
    try {
      await vi.waitFor(() => { expect(reads).toHaveLength(1) })
      show('another-session' as SessionId)
      expect(reads[0]?.signal.aborted).toBe(true)
      show(sessionId)
      await vi.waitFor(() => { expect(reads).toHaveLength(2) })
      connect()
      expect(reads[1]?.signal.aborted).toBe(true)
      connect(2)
      await vi.waitFor(() => { expect(reads).toHaveLength(3) })
      expect(reads.map(read => read.sessionId)).toEqual([sessionId, sessionId, sessionId])
      picture()
      expect(reads[2]?.signal.aborted).toBe(false)
      await remove()
      expect(reads[2]?.signal.aborted).toBe(true)
      expect(resources.source(address).getSnapshot().status).toBe('none')
    } finally {
      picture()
      sidebar.abort()
    }
  } finally {
    await source.fiber.dispose()
    await ctx.fiber.dispose()
  }
})
