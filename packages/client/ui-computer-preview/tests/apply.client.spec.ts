/** Shared preview source registration is independent and reversible. */

import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import * as PreviewUi from '../src/client/index.ts'

it('registers both sources after a late header declaration and withdraws each independently', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SlotRegistry)
    ctx.provide('locale', new LocaleRuntime(ctx))
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
      expect(slots.entries('conversation.session.header.utilities')).toHaveLength(0)
      slots.register({ name: 'root', children: { 'conversation.session.header.utilities': { kind: 'append', scope: 'root' } } } as never, () => null)
      expect(slots.entries('conversation.session.header.utilities').map(entry => entry.options.id)).toEqual(['applications-control.preview', 'browser-control.preview'])
      await removeBrowser()
      expect(slots.entries('conversation.session.header.utilities').map(entry => entry.options.id)).toEqual(['applications-control.preview'])
      await removeApp()
      expect(slots.entries('conversation.session.header.utilities')).toHaveLength(0)
    } finally { await browser.fiber.dispose(); await app.fiber.dispose() }
    await fiber.dispose()
    expect(ctx.get('computerPreviewUi')).toBeUndefined()
  } finally { await ctx.fiber.dispose() }
})
