/** Plugin configuration, phone disconnection, and Remote registrations follow their activation. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import * as Resources from '@deepseek-ai/dsh-client-resources/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { inject, mountMobileAccess } from '../src/client/mount.ts'
import type { MobileAccessRowInjected } from '../src/client/MobileAccessRow.tsx'

it('registers phone connection on the plugin page and withdraws its live resource and slots', async () => {
  const ctx = new Context()
  const withdrawn = vi.fn()
  class ScriptedRemote extends TestRemote {
    override $mount(): Promise<() => Promise<void>> { return Promise.resolve(async () => { withdrawn() }) }
  }
  let failed = false
  const result = () => Promise.resolve(failed ? { ok: false, error: new Error('fixture refusal') } : {
    ok: true, value: { networks: [], phone: false },
  })
  try {
    await ctx.plugin(SlotRegistry)
    await ctx.plugin(Resources)
    ctx.provide('locale', new LocaleRuntime(ctx))
    new ScriptedRemote(ctx, { mobileAccess: { describe: result, open: result, close: result, regenerate: result,
      async *watch() { yield { networks: [], phone: false } },
    } })
    const contribution: TypertRemoteContribution = { package: '@deepseek-ai/dsh-experimental-mobile-access', descriptors: [] }
    const fiber = ctx.plugin({ inject, async apply(owner) { return await mountMobileAccess(owner, contribution) } })
    await fiber
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: {
      'settings.launcher': { kind: 'single', scope: 'root' }, 'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    } } as never, () => null)
    await vi.waitFor(() => { expect(slots.entries('plugins.bundle.config')).toHaveLength(1) })
    const phone = slots.entries('plugins.bundle.config')[0]!.inject!() as Partial<MobileAccessRowInjected>
    const actions = [() => phone.open!('127.0.0.1'), phone.close!, phone.regenerate!]
    for (const action of actions) expect(await action()).toMatchObject({ phone: false })
    failed = true
    for (const action of actions) await expect(action()).rejects.toThrow('fixture refusal')
    phone.onOutcome!('updated')
    const controller = new AbortController()
    ctx.resources.pin('dsh-resource://mobile-access/connection', controller.signal)
    await vi.waitFor(() => { expect(ctx.resources.source('dsh-resource://mobile-access/connection').getSnapshot().status).toBe('live') })
    controller.abort()
    await fiber.dispose()
    expect(slots.entries('settings.launcher')).toHaveLength(0)
    expect(slots.entries('plugins.bundle.config')).toHaveLength(0)
    expect(withdrawn).toHaveBeenCalledOnce()
  } finally { await ctx.fiber.dispose() }
})

it('disconnects a phone through the independent HTTP route and navigates only after success', async () => {
  const ctx = new Context()
  const replace = vi.fn()
  const send = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response(null, { status: 503 }))
  vi.stubGlobal('location', { href: 'https://device.example/', replace })
  vi.stubGlobal('fetch', send)
  class ScriptedRemote extends TestRemote {
    override $mount(): Promise<() => Promise<void>> { return Promise.resolve(() => Promise.resolve()) }
  }
  try {
    await ctx.plugin(SlotRegistry)
    await ctx.plugin(Resources)
    ctx.provide('locale', new LocaleRuntime(ctx))
    new ScriptedRemote(ctx, { mobileAccess: { async *watch() { yield { networks: [], phone: true } } } })
    const contribution: TypertRemoteContribution = { package: '@deepseek-ai/dsh-experimental-mobile-access', descriptors: [] }
    await ctx.plugin({ inject, async apply(owner) { return await mountMobileAccess(owner, contribution) } })
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: { 'plugins.bundle.config': { kind: 'keyed', scope: 'root' } } } as never, () => null)
    await vi.waitFor(() => { expect(slots.entries('plugins.bundle.config')).toHaveLength(1) })
    const phone = slots.entries('plugins.bundle.config')[0]!.inject!() as Partial<MobileAccessRowInjected>
    await phone.disconnectPhone!()
    expect(send).toHaveBeenCalledWith(new URL('https://device.example/neurix/disconnect'), { method: 'POST', credentials: 'same-origin' })
    expect(replace).toHaveBeenCalledExactlyOnceWith('/')
    await expect(phone.disconnectPhone!()).rejects.toThrow('could not be confirmed')
    expect(replace).toHaveBeenCalledOnce()
  } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals() }
})
