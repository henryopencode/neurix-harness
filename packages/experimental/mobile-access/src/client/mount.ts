/** Source-owned phone connection menu over generated Remote methods. @module */
import type { Context } from '@deepseek-ai/cordis'
import { RemoteError, type TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-experimental-mobile-access/remote'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { MobileAccessState } from '../types.ts'
import { MobileAccessRow } from './MobileAccessRow.tsx'
import { NeurixMenu } from './NeurixMenu.tsx'
import { ConnectionNotice } from './notice.ts'
import { ConnectionToast } from './ConnectionToast.tsx'
import { en, zh, ja, es, fr, de, ru, pt, type MobileAccessLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Phone connection and application menu copy. */
    'settings.mobileAccess': MobileAccessLocaleKey
  }
  interface ResourceProtocolMap {
    /** Live state of the same Host's phone connection. */
    'mobile-access': MobileAccessState
  }
}

/** Services used by the phone connection menu and its live resource. */
export const inject = ['remote', 'slots', 'locale', 'resources']

/**
 * Register the phone connection menu and generated Remote methods.
 * @param ctx - existing Client context.
 * @param contribution - generated phone-access Remote.
 * @returns quiescent withdrawal of the Client contribution.
 */
export async function mountMobileAccess(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  ctx.effect(() => ctx.locale.register('settings.mobileAccess', { en, zh, ja, es, fr, de, ru, pt }))
  const unmount = await ctx.remote.$mount(contribution)
  const notice = new ConnectionNotice()
  const onOutcome = (outcome: Parameters<ConnectionNotice['report']>[0]) => { notice.report(outcome) }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'phone-connection-notice', locale: 'settings.mobileAccess',
    inject: () => ({ hooks: { connectionNotice: notice.source }, dismiss: () => { notice.dismiss() } }),
  }, ConnectionToast))
  const child = ctx.inject(['remote.mobileAccess'], (owner) => {
    owner.effect(() => owner.resources.register<'mobile-access'>({ protocol: 'mobile-access',
      async *open(_address, { signal }) {
        try { for await (const value of owner.remote.mobileAccess.watch(signal)) yield { ok: true as const, value } }
        catch (_error) {
          if (!signal.aborted) yield { ok: false as const, error: new RemoteError('mobile-access/unavailable', 'Reopen Phone connection to reconnect', {}) }
        }
      },
    }))
    owner.slots.inject('settings.launcher', () => owner.slots.register({
      name: 'settings.launcher', locale: 'settings.mobileAccess',
    }, NeurixMenu))
    owner.slots.inject('plugins.bundle.config', () => owner.slots.register({
      name: 'plugins.bundle.config', key: '@deepseek-ai/dsh-experimental-mobile-access', locale: 'settings.mobileAccess',
      inject: () => ({ onOutcome,
        disconnectPhone: async () => {
          const result = await fetch(new URL('/neurix/disconnect', location.href), { method: 'POST', credentials: 'same-origin' })
          if (!result.ok) throw new Error('Phone disconnection could not be confirmed')
          location.replace('/')
        },
        open: async (host: string) => {
          const result = await owner.remote.mobileAccess.open(host)
          if (!result.ok) throw result.error
          return result.value
        },
        close: async () => {
          const result = await owner.remote.mobileAccess.close()
          if (!result.ok) throw result.error
          return result.value
        },
        regenerate: async () => {
          const result = await owner.remote.mobileAccess.regenerate()
          if (!result.ok) throw result.error
          return result.value
        },
      }),
    }, MobileAccessRow))
  })
  return async () => { await child.dispose(); await unmount() }
}
