/** Source-safe settings and picture-in-picture registration. @module */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-experimental-computer-control/remote'
import type { ComputerPreviewSnapshot } from '../preview-types.ts'
import { ComputerPreview } from './ComputerPreview.tsx'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ComputerCard } from './ComputerCard.tsx'
import { COMPUTER_CONTROL_BUNDLE, COMPUTER_CONTROL_ENTRY, ComputerCardController } from './controller.ts'
import { en, zh, ja, es, fr, de, ru, pt, type ComputerControlLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Computer-control settings and manual test copy. */
    'settings.computerControl': ComputerControlLocaleKey
  }
}

/** Services that supply configuration values, localized copy, and slots. */
export const inject = ['slots', 'locale', 'configForms', 'remote']

/**
 * Register the bundle-owned configuration page, including after late slot declaration.
 * @param ctx - browser plugin context.
 */
function registerSettings(ctx: Context): void {
  const namespace = 'settings.computerControl'
  ctx.effect(() => ctx.locale.register(namespace, { en, zh, ja, es, fr, de, ru, pt }), 'computer-control: dictionary')
  const controller = new ComputerCardController(ctx.configForms.get(COMPUTER_CONTROL_ENTRY))
  ctx.effect(() => () => { controller.dispose() }, 'computer-control: form')
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: COMPUTER_CONTROL_BUNDLE, locale: namespace,
    inject: () => controller.inject(),
  }, ComputerCard))
}

/**
 * Mount settings and optional computer-preview Remote on the existing header.
 * @param ctx - browser plugin context.
 * @param contribution - generated preview Remote declaration.
 * @returns quiescent UI and Remote withdrawal.
 */
export async function mountComputerControlUi(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  registerSettings(ctx)
  const unmount = await ctx.remote.$mount(contribution)
  const lifetime = new AbortController()
  const pending = new Set<Promise<ComputerPreviewSnapshot>>()
  const preview = ctx.inject(['remote.computerPreview'], (child) => {
    child.slots.inject('conversation.session.header.utilities', () => child.slots.register({
      name: 'conversation.session.header.utilities', id: 'computer-control.preview', locale: 'settings.computerControl',
      inject: () => ({ loadPreview: (sessionId: SessionId, signal: AbortSignal) => {
        const active = AbortSignal.any([signal, lifetime.signal])
        const operation = child.remote.computerPreview.frame(sessionId, active).then((result) => {
          if (!result.ok) throw result.error
          active.throwIfAborted()
          return result.value
        })
        pending.add(operation)
        void operation.finally(() => { pending.delete(operation) }).catch(() => {})
        return operation
      } }),
    }, ComputerPreview))
  })
  return async () => {
    lifetime.abort()
    await preview.dispose()
    await Promise.allSettled(pending)
    await unmount()
  }
}
