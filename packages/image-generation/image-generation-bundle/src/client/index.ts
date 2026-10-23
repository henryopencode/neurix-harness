/** Plugin detail configuration for optional image generation. @module */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ImageGenerationCard } from './ImageGenerationCard.tsx'
import { ImageGenerationStatus } from './ImageGenerationStatus.tsx'
import { IMAGE_GENERATION_ENTRY, ImageGenerationCardController } from './image-generation-controller.ts'
import { en, zh, ja, es, fr, de, ru, pt, type ImageGenerationLocaleKey } from './locales.ts'

export type { ImageGenerationLocaleKey } from './locales.ts'
export type { ImageGenerationCardProps } from './ImageGenerationCard.tsx'
export type { ImageGenerationSettings, ImageGenerationCardState, ImageGenerationCardFace } from './image-generation-controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Image-generation configuration copy. */
    'settings.imageGeneration': ImageGenerationLocaleKey
  }
}

/** Services required to render and persist image-generation settings. */
export const inject = ['slots', 'locale', 'configForms']

/**
 * Register the bundle's staged configuration on its plugin detail page.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: Context): void {
  const namespace = 'settings.imageGeneration'
  ctx.effect(() => ctx.locale.register(namespace, { en, zh, ja, es, fr, de, ru, pt }), 'image-generation: dictionary')
  const controller = new ImageGenerationCardController(ctx.configForms.get(IMAGE_GENERATION_ENTRY), ctx.configForms.describe())
  ctx.effect(() => () => { controller.dispose() }, 'image-generation: form')
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: '@deepseek-ai/dsh-image-generation-bundle', locale: namespace,
    inject: () => controller.inject(),
  }, ImageGenerationCard))
  ctx.slots.inject('plugins.bundle.status', () => ctx.slots.register({
    name: 'plugins.bundle.status', key: '@deepseek-ai/dsh-image-generation-bundle', locale: namespace,
    inject: () => ({ hooks: { configurations: ctx.configForms.describe() } }),
  }, ImageGenerationStatus))
}
