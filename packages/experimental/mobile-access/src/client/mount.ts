/** Source-owned phone settings registration over generated Remote methods. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-experimental-mobile-access/remote'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { MobileAccessRow } from './MobileAccessRow.tsx'
import { NeurixMenu } from './NeurixMenu.tsx'
import { en, zh, type MobileAccessLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Phone connection settings and owner credential handling. */
    'settings.mobileAccess': MobileAccessLocaleKey
  }
}

/** Services used by the phone connection row. */
export const inject = ['remote', 'slots', 'locale']

/**
 * Register private connection settings and generated Remote methods.
 * @param ctx - existing Client context.
 * @param contribution - generated phone-access Remote.
 * @returns quiescent withdrawal of the Client contribution.
 */
export async function mountMobileAccess(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  ctx.effect(() => ctx.locale.register('settings.mobileAccess', { en, zh }))
  const unmount = await ctx.remote.$mount(contribution)
  const account = ctx.inject(['remote.neurixAccount'], (owner) => {
    const loadAccount = async () => {
      const result = await owner.remote.neurixAccount.describe()
      if (!result.ok) throw result.error
      return result.value
    }
    owner.slots.inject('settings.launcher', () => owner.slots.register({
      name: 'settings.launcher', locale: 'settings.mobileAccess', inject: () => ({ loadAccount,
        register: async (username: string, password: string) => {
          const result = await owner.remote.neurixAccount.register(username, password)
          if (!result.ok) throw result.error
          return result.value
        },
        signIn: async (username: string, password: string) => {
          const result = await owner.remote.neurixAccount.signIn(username, password)
          if (!result.ok) throw result.error
          return result.value
        },
        signOut: async () => {
          const caller = await owner.remote.neurixAccount.describe()
          if (!caller.ok) throw caller.error
          if (caller.value.phone === true) {
            const result = await fetch(new URL('./neurix/logout', location.href), { method: 'POST', credentials: 'same-origin' })
            if (!result.ok) throw new Error('Phone logout could not be confirmed')
            location.reload()
            return { configured: true, signedIn: false }
          }
          const result = await owner.remote.neurixAccount.signOut()
          if (!result.ok) throw result.error
          return result.value
        },
      }),
    }, NeurixMenu))
  })
  const child = ctx.inject(['remote.mobileAccess'], (owner) => {
    const load = async () => {
      const result = await owner.remote.mobileAccess.describe()
      if (!result.ok) throw result.error
      return result.value
    }
    owner.slots.inject('settings.general.item', () => owner.slots.register({
      name: 'settings.general.item', id: 'mobile-access', order: 90, locale: 'settings.mobileAccess',
      inject: () => ({ load,
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
      }),
    }, MobileAccessRow))
  })
  return async () => { await child.dispose(); await account.dispose(); await unmount() }
}
