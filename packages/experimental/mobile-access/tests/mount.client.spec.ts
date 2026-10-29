/** Source registration and each generated Remote outcome follow the plugin's lifetime. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { inject, mountMobileAccess } from '../src/client/mount.ts'
import type { NeurixMenuInjected } from '../src/client/NeurixMenu.tsx'
import type { MobileAccessRowInjected } from '../src/client/MobileAccessRow.tsx'

it('withdraws the launcher and phone settings, and reports failed account and connection operations', async () => {
  const ctx = new Context()
  const withdrawn = vi.fn()
  class ScriptedRemote extends TestRemote {
    override $mount(): Promise<() => Promise<void>> { return Promise.resolve(async () => { withdrawn() }) }
  }
  let failed = false
  const describe = vi.fn(() => result())
  const result = () => Promise.resolve(failed ? { ok: false, error: new Error('fixture refusal') } : {
    ok: true, value: { configured: false, signedIn: false },
  })
  try {
    await ctx.plugin(SlotRegistry)
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    new ScriptedRemote(ctx, { neurixAccount: { describe, register: result, signIn: result, signOut: result },
      mobileAccess: { describe: result, open: result, close: result } })
    const contribution: TypertRemoteContribution = { package: '@deepseek-ai/dsh-experimental-mobile-access', descriptors: [] }
    const fiber = ctx.plugin({ inject, async apply(owner) { return await mountMobileAccess(owner, contribution) } })
    await fiber
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: {
      'settings.launcher': { kind: 'single', scope: 'root' }, 'settings.general.item': { kind: 'list', scope: 'root' },
    } } as never, () => null)
    await vi.waitFor(() =>{  expect(slots.entries('settings.launcher')).toHaveLength(1) })
    const account = slots.entries('settings.launcher')[0]!.inject!() as Partial<NeurixMenuInjected>
    const phone = slots.entries('settings.general.item')[0]!.inject!() as Partial<MobileAccessRowInjected>
    const actions = [account.loadAccount!, () => account.register!('fixture', 'synthetic-password'),
      () => account.signIn!('fixture', 'synthetic-password'), account.signOut!,
      phone.load!, () => phone.open!('127.0.0.1'), phone.close!]
    for (const action of actions) expect(await action()).toMatchObject({ configured: false })
    failed = true
    for (const action of actions) await expect(action()).rejects.toThrow('fixture refusal')
    describe.mockResolvedValueOnce({ ok: true, value: { configured: true, signedIn: true } })
    await expect(account.signOut!()).rejects.toThrow('fixture refusal')
    await fiber.dispose()
    expect(slots.entries('settings.launcher')).toHaveLength(0)
    expect(slots.entries('settings.general.item')).toHaveLength(0)
    expect(withdrawn).toHaveBeenCalledTimes(1)
  } finally { await ctx.fiber.dispose() }
})

it('uses the independent phone logout route and reloads only after success', async () => {
  const ctx = new Context()
  const reload = vi.fn()
  const send = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response(null, { status: 503 }))
  vi.stubGlobal('location', { href: 'https://device.example/', reload })
  vi.stubGlobal('fetch', send)
  class ScriptedRemote extends TestRemote {
    override $mount(): Promise<() => Promise<void>> { return Promise.resolve(() => Promise.resolve()) }
  }
  try {
    await ctx.plugin(SlotRegistry)
    ctx.provide('locale', new LocaleRuntime(ctx))
    new ScriptedRemote(ctx, { neurixAccount: { describe: () => Promise.resolve({
      ok: true, value: { configured: true, signedIn: true, phone: true },
    }) } })
    const contribution: TypertRemoteContribution = { package: '@deepseek-ai/dsh-experimental-mobile-access', descriptors: [] }
    await ctx.plugin({ inject, async apply(owner) { return await mountMobileAccess(owner, contribution) } })
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: { 'settings.launcher': { kind: 'single', scope: 'root' } } } as never, () => null)
    await vi.waitFor(() => { expect(slots.entries('settings.launcher')).toHaveLength(1) })
    const account = slots.entries('settings.launcher')[0]!.inject!() as Partial<NeurixMenuInjected>
    expect(await account.signOut!()).toEqual({ configured: true, signedIn: false })
    expect(send).toHaveBeenCalledWith(new URL('https://device.example/neurix/logout'), { method: 'POST', credentials: 'same-origin' })
    expect(reload).toHaveBeenCalledTimes(1)
    await expect(account.signOut!()).rejects.toThrow('could not be confirmed')
    expect(reload).toHaveBeenCalledTimes(1)
  } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals() }
})
