/** Slot contribution follows plugin lifetime and supports late declaration. */

import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import * as settings from '@deepseek-ai/dsh-client-ui-settings/client'
import * as PreviewUi from '@deepseek-ai/dsh-client-ui-computer-preview/client'
import { inject, mountComputerControlUi } from '../src/client/mount.ts'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'

class PreviewRemote extends TestRemote {
  override $mount(): Promise<() => Promise<void>> { return Promise.resolve(async () => {}) }
}

it('registers a localized configuration after the Plugins slot appears and removes it on unload', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SlotRegistry)
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('zh')
    ctx.provide('locale', locale)
    new PreviewRemote(ctx, { settings: { describe: () => Promise.resolve({
      ok: true, value: { writable: true, hasDocument: true, namespaces: [] },
    }) } })
    await ctx.plugin(settings)
    await ctx.plugin(PreviewUi)
    const contribution: TypertRemoteContribution = { package: '@deepseek-ai/dsh-experimental-computer-control', descriptors: [] }
    const fiber = ctx.plugin({ inject, async apply(child) { return await mountComputerControlUi(child, contribution) } })
    await fiber
    const slots = ctx.get('slots') as SlotRegistry
    expect(slots.entries('plugins.bundle.config')).toHaveLength(0)
    slots.register({ name: 'root', children: { 'plugins.bundle.config': { kind: 'keyed', scope: 'root' } } } as never, () => null)
    await vi.waitFor(() => { expect(slots.entries('plugins.bundle.config')).toHaveLength(1) })
    expect(slots.entries('plugins.bundle.config')[0]?.options.key).toBe('@deepseek-ai/dsh-experimental-computer-control')
    expect(slots.entries('plugins.bundle.config')[0]?.inject?.()).toHaveProperty('hooks.computerCard')
    expect(locale.bind('settings.computerControl')('description')).toContain('仅支持 macOS')
    await fiber.dispose()
    expect(slots.entries('plugins.bundle.config')).toHaveLength(0)
  } finally { await ctx.fiber.dispose() }
})
