/** Optional foreground application-control settings and per-Agent runtime composition. @module */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { Config as ProviderConfig, mountComputerControl } from '@deepseek-ai/dsh-experimental-computer-use-unified'
import { ComputerPreviewSources } from '@deepseek-ai/dsh-experimental-computer-preview'
import type {} from '@deepseek-ai/dsh-settings'
import { ComputerPreviewController } from './preview.ts'
export { ComputerPreviewController } from './preview.ts'
export type { ComputerPreviewSnapshot } from './preview-types.ts'

/** Cordis plugin identity. */
export const name = 'experimental-computer-control'

/** Services required by the mounted unified provider. */
export const inject = ['computerUse', 'agents', 'tools', 'systemPrompt']

/** Saved runtime defaults, live approval, and live preview pacing. */
export interface Config {
  /** One-shot input approval; changes apply to the next operation in every Session. */
  requireInputApproval: Volatile<boolean>
  /** Foreground shortcut settling interval in milliseconds. */
  keySettleMs: Volatile<number>
  /** Display the glowing pointer and key indicators. */
  showOverlay: Volatile<boolean>
  /** Foreground pointer glide duration in milliseconds. */
  cursorMoveDurationMs: Volatile<number>
  /** Target duration of foreground scrolling in milliseconds. */
  scrollDurationMs: Volatile<number>
  /** Delay between visible text characters in milliseconds. */
  typingDelayMs: Volatile<number>
  /** Idle lifetime of the pointer and key indicators in milliseconds. */
  overlayIdleMs: Volatile<number>
  /** Delay between display-only picture-in-picture captures in milliseconds. */
  previewIntervalMs: Volatile<number>
  /** Delay between preview captures while an input indicator is active, in milliseconds. */
  previewActiveIntervalMs: Volatile<number>
  /** Delay between preview checks when no target exists, in milliseconds. */
  previewIdleIntervalMs: Volatile<number>
  /** Include screenshots; enable for a model that supports image input. */
  screenshots: Volatile<boolean>
  /** Elapsed deadline for input, observation, and discovery in milliseconds. */
  operationTimeoutMs: Volatile<number>
  /** Time allowed for one native accessibility walk, in milliseconds. */
  nativeTreeTimeoutMs: Volatile<number>
  /** Elapsed deadline for application launch in milliseconds. */
  navigationTimeoutMs: Volatile<number>
}

// The config catalog requires literal keys for each plugin’s independent settings.
/* jscpd:ignore-start */
/** Runtime defaults apply on acquisition; approval and preview pacing apply immediately. */
export const Config = Schema.object({
  requireInputApproval: Schema.boolean().default(false).volatile(),
  keySettleMs: Schema.number().step(1).min(0).max(2000).default(300).volatile(),
  showOverlay: Schema.boolean().default(true).volatile(),
  cursorMoveDurationMs: Schema.number().step(1).min(0).max(5000).default(450).volatile(),
  scrollDurationMs: Schema.number().step(1).min(0).max(5000).default(650).volatile(),
  typingDelayMs: Schema.number().step(1).min(0).max(200).default(45).volatile(),
  overlayIdleMs: Schema.number().step(1).min(100).max(60_000).default(1600).volatile(),
  previewIntervalMs: Schema.number().step(1).min(250).max(10_000).default(250).volatile(),
  previewActiveIntervalMs: Schema.number().step(1).min(40).max(1000).default(80).volatile(),
  previewIdleIntervalMs: Schema.number().step(1).min(250).max(30_000).default(2000).volatile(),
  screenshots: Schema.boolean().default(false).volatile(),
  operationTimeoutMs: Schema.number().step(1).min(1).max(2 ** 31 - 1).default(15_000).volatile(),
  nativeTreeTimeoutMs: Schema.number().step(1).min(100).max(120_000).default(5000).volatile(),
  navigationTimeoutMs: Schema.number().step(1).min(1).max(2 ** 31 - 1).default(30_000).volatile(),
})
/* jscpd:ignore-end */

/**
 * Mount foreground desktop control with editable defaults, live approval, and preview pacing.
 * @param ctx - context with the provider's required services.
 * @param config - live fields owned by the settings document.
 * @returns after tool registration; native startup occurs on first desktop use.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const preview = ComputerPreviewSources.mount(ctx, ComputerPreviewController, config)
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  await mountComputerControl(ctx, () => ProviderConfig({
    requireInputApproval: config.requireInputApproval.get(),
    inputMode: 'foreground',
    nativeBackground: false,
    keySettleMs: config.keySettleMs.get(),
    showOverlay: config.showOverlay.get(),
    cursorMoveDurationMs: config.cursorMoveDurationMs.get(), scrollDurationMs: config.scrollDurationMs.get(),
    typingDelayMs: config.typingDelayMs.get(),
    overlayIdleMs: config.overlayIdleMs.get(),
    screenshots: config.screenshots.get(),
    operationTimeoutMs: config.operationTimeoutMs.get(), navigationTimeoutMs: config.navigationTimeoutMs.get(),
    nativeTreeTimeoutMs: config.nativeTreeTimeoutMs.get(),
  }), (sessionId, capture) => preview.register(sessionId, capture), 'applications')
}
