/** Browser settings and independent display-only preview registration. @module */

import type { Context } from '@deepseek-ai/cordis'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { BrowserPreviewSnapshot } from '../types.ts'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-experimental-browser-control/remote'
import type {} from '@deepseek-ai/dsh-client-ui-computer-preview/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { BrowserCard } from './BrowserCard.tsx'
import { BROWSER_CONTROL_BUNDLE, BROWSER_CONTROL_ENTRY, BrowserCardController } from './controller.ts'
import { en, zh, ja, es, fr, de, ru, pt, type BrowserControlLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Independent browser settings copy. */
    'settings.browserControl': BrowserControlLocaleKey
  }
}

/** UI services, including the injected shared preview renderer. */
export const inject = ['slots', 'locale', 'configForms', 'remote', 'computerPreviewUi']

/**
 * Mount browser-only settings and the browser's exact preview Remote.
 * @param ctx - browser plugin context with shared UI services.
 * @param contribution - generated browser-preview Remote descriptors.
 * @returns quiescent withdrawal of UI, requests, and Remote descriptors.
 */
export async function mountBrowserControlUi(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  ctx.effect(() => ctx.locale.register('settings.browserControl', { en, zh, ja, es, fr, de, ru, pt }), 'browser-control: dictionary')
  const controller = new BrowserCardController(ctx.configForms.get(BROWSER_CONTROL_ENTRY))
  ctx.effect(() => () => { controller.dispose() }, 'browser-control: form')
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: BROWSER_CONTROL_BUNDLE, locale: 'settings.browserControl',
    inject: () => controller.inject(),
  }, BrowserCard))
  const unmount = await ctx.remote.$mount(contribution)
  const lifetime = new AbortController()
  const pending = new Set<Promise<BrowserPreviewSnapshot>>()
  const preview = ctx.inject(['remote.browserPreview'], child => child.computerPreviewUi.register(child, {
    surface: 'browser', loadPreview: (sessionId, signal) => {
      const active = AbortSignal.any([signal, lifetime.signal])
      const operation = child.remote.browserPreview.frame(sessionId, active).then((result) => {
        if (!result.ok) throw result.error
        active.throwIfAborted()
        return result.value
      })
      pending.add(operation)
      void operation.finally(() => { pending.delete(operation) }).catch(() => {})
      return operation
    },
  }))
  return async () => {
    lifetime.abort()
    await preview.dispose()
    await Promise.allSettled(pending)
    await unmount()
  }
}
