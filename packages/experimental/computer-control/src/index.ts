/** Optional computer-control settings and per-Agent runtime composition. @module */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { Config as ProviderConfig, mountComputerControl } from '@deepseek-ai/dsh-experimental-computer-use-unified'
import type {} from '@deepseek-ai/dsh-settings'
import { ComputerPreviewController, ComputerPreviewSources } from './preview.ts'
export { ComputerPreviewController } from './preview.ts'
export type { ComputerPreviewSnapshot } from './preview-types.ts'

/** Cordis plugin identity. */
export const name = 'experimental-computer-control'

/** Services required by the mounted unified provider. */
export const inject = ['computerUse', 'browserUse', 'agents', 'tools', 'systemPrompt']

/** Saved runtime defaults, live input mode and approval, and live preview pacing. */
export interface Config {
  /** One-shot input approval; changes apply to the next operation in every Session. */
  requireInputApproval: Volatile<boolean>
  /** Browser-only background or explicit foreground system input; changes apply to the next operation. */
  inputMode: Volatile<'foreground' | 'background'>
  /** Foreground shortcut settling interval in milliseconds. */
  keySettleMs: Volatile<number>
  /** Display the glowing pointer and key indicators. */
  showOverlay: Volatile<boolean>
  /** Pointer glide and browser drag duration in milliseconds. */
  cursorMoveDurationMs: Volatile<number>
  /** Target duration of a browser wheel gesture in milliseconds. */
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
  /** Installed browser distribution. */
  browserChannel: Volatile<'chrome' | 'chromium' | 'msedge'>
  /** Hide browser windows. */
  headless: Volatile<boolean>
  /** Include screenshots; enable for a model that supports image input. */
  screenshots: Volatile<boolean>
  /** Elapsed deadline for input, observation, and discovery in milliseconds. */
  operationTimeoutMs: Volatile<number>
  /** Time allowed for one native accessibility walk, in milliseconds. */
  nativeTreeTimeoutMs: Volatile<number>
  /** Elapsed deadline for application launch, browser startup, and navigation in milliseconds. */
  navigationTimeoutMs: Volatile<number>
}

/** Runtime defaults apply on acquisition; input mode, approval, and preview pacing apply immediately. */
export const Config = Schema.object({
  requireInputApproval: Schema.boolean().default(false).volatile(),
  inputMode: Schema.union(['foreground', 'background']).default('background').volatile(),
  keySettleMs: Schema.number().step(1).min(0).max(2000).default(300).volatile(),
  showOverlay: Schema.boolean().default(true).volatile(),
  cursorMoveDurationMs: Schema.number().step(1).min(0).max(5000).default(450).volatile(),
  scrollDurationMs: Schema.number().step(1).min(0).max(5000).default(650).volatile(),
  typingDelayMs: Schema.number().step(1).min(0).max(200).default(45).volatile(),
  overlayIdleMs: Schema.number().step(1).min(100).max(60_000).default(1600).volatile(),
  previewIntervalMs: Schema.number().step(1).min(250).max(10_000).default(250).volatile(),
  previewActiveIntervalMs: Schema.number().step(1).min(40).max(1000).default(80).volatile(),
  previewIdleIntervalMs: Schema.number().step(1).min(250).max(30_000).default(2000).volatile(),
  browserChannel: Schema.union(['chrome', 'chromium', 'msedge']).default('chrome').volatile(),
  headless: Schema.boolean().default(false).volatile(),
  screenshots: Schema.boolean().default(false).volatile(),
  operationTimeoutMs: Schema.number().step(1).min(1).max(2 ** 31 - 1).default(15_000).volatile(),
  nativeTreeTimeoutMs: Schema.number().step(1).min(100).max(120_000).default(5000).volatile(),
  navigationTimeoutMs: Schema.number().step(1).min(1).max(2 ** 31 - 1).default(30_000).volatile(),
})

/**
 * Mount computer control with editable defaults and live input mode, approval, and preview pacing.
 * @param ctx - context with the provider's required services.
 * @param config - live fields owned by the settings document.
 * @returns after tool registration; native startup occurs on first desktop use.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const preview = new ComputerPreviewSources()
  ctx.effect(() => () => preview.dispose(), 'computer-control: display captures')
  ctx.inject(['typert'], async (child) => {
    await child.plugin(ComputerPreviewController, {
      sources: preview, refreshMs: (active, idle) => idle ? config.previewIdleIntervalMs.get()
        : active ? config.previewActiveIntervalMs.get() : config.previewIntervalMs.get(),
    })
  })
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  await mountComputerControl(ctx, () => ProviderConfig({
    requireInputApproval: config.requireInputApproval.get(),
    inputMode: config.inputMode.get(),
    nativeBackground: false,
    keySettleMs: config.keySettleMs.get(),
    showOverlay: config.showOverlay.get(),
    cursorMoveDurationMs: config.cursorMoveDurationMs.get(), scrollDurationMs: config.scrollDurationMs.get(),
    typingDelayMs: config.typingDelayMs.get(),
    overlayIdleMs: config.overlayIdleMs.get(),
    browserChannel: config.browserChannel.get(), headless: config.headless.get(), screenshots: config.screenshots.get(),
    operationTimeoutMs: config.operationTimeoutMs.get(), navigationTimeoutMs: config.navigationTimeoutMs.get(),
    nativeTreeTimeoutMs: config.nativeTreeTimeoutMs.get(),
  }), (sessionId, capture) => preview.register(sessionId, capture))
}
