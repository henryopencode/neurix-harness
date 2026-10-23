/** Configuration registration follows the bundle fiber and late slot declarations. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import * as client from '../src/client/index.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  new TestRemote(ctx, { settings: { describe: () => Promise.resolve({ ok: true,
    value: { writable: true, hasDocument: true, namespaces: [] } }) } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({ name: 'root', children: {
    'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
    'plugins.bundle.status': { kind: 'keyed', scope: 'root' },
    'settings.section': { kind: 'list', scope: 'root' },
  } } as never, () => null)
}

describe('image-generation configuration registration', () => {
  it('registers a localized form on the bundle and releases it on disposal', async () => {
    const { ctx, slots } = await bench()
    try {
      declare(slots)
      const fiber = await ctx.plugin(client).await()
      await vi.waitFor(() => { expect(slots.entries('plugins.bundle.config')).toHaveLength(1) })
      const entry = slots.entries('plugins.bundle.config')[0]!
      expect(entry.options.key).toBe('@deepseek-ai/dsh-image-generation-bundle')
      expect(slots.entries('plugins.bundle.status')[0]?.options.key).toBe('@deepseek-ai/dsh-image-generation-bundle')
      expect(ctx.locale.bind('settings.imageGeneration')('enabled')).toBe('启用对话生图')
      expect(entry.inject?.()).toHaveProperty('hooks.imageGeneration')
      expect(slots.entries('settings.section')).toHaveLength(0)
      ctx.locale.setLocale('en')
      expect(ctx.locale.bind('settings.imageGeneration')('enabled')).toBe('Enable image generation in conversations')
      await fiber.dispose()
      expect(slots.entries('plugins.bundle.config')).toHaveLength(0)
      expect(slots.entries('plugins.bundle.status')).toHaveLength(0)
      expect(slots.entries('settings.section')).toHaveLength(0)
    } finally { await ctx.fiber.dispose() }
  })

  it('registers when the Plugins page declares its slot after the bundle loads', async () => {
    const { ctx, slots } = await bench()
    try {
      await ctx.plugin(client).await()
      expect(slots.entries('plugins.bundle.config')).toHaveLength(0)
      expect(slots.entries('plugins.bundle.status')).toHaveLength(0)
      expect(slots.entries('settings.section')).toHaveLength(0)
      declare(slots)
      await vi.waitFor(() => { expect(slots.entries('plugins.bundle.config')).toHaveLength(1) })
      expect(slots.entries('plugins.bundle.status')).toHaveLength(1)
      expect(slots.entries('settings.section')).toHaveLength(0)
    } finally { await ctx.fiber.dispose() }
  })
})
