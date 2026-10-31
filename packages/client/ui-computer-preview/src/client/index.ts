/** Shared display-only preview service for independently enabled control plugins. @module */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createPreviewUi } from './preview-ui.ts'
import { en, zh, ja, es, fr, de, ru, pt, type ComputerControlLocaleKey } from './locales.ts'
export type { ComputerPreviewUi, PreviewSource } from './preview-ui.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Shared preview controls with independent source labels. */
    computerPreview: ComputerControlLocaleKey
  }
}

/** Shared presentation dependencies; no operating runtime is started. */
export const inject = ['slots', 'locale']

/**
 * Provide the shared renderer without registering an application or browser source.
 * @param ctx - Client context with slots and localized copy.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('computerPreview', { en, zh, ja, es, fr, de, ru, pt }), 'computer-preview: dictionary')
  ctx.provide('computerPreviewUi', createPreviewUi())
}
