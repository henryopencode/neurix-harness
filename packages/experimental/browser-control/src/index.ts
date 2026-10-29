/** Isolated hidden-browser settings and per-Agent Playwright composition. @module */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { Config as ProviderConfig, mountComputerControl } from '@deepseek-ai/dsh-experimental-computer-use-unified'
import { ComputerPreviewSources } from '@deepseek-ai/dsh-experimental-computer-preview'
import type {} from '@deepseek-ai/dsh-settings'
import { BrowserPreviewController } from './preview.ts'
export { BrowserPreviewController } from './preview.ts'

/** Cordis plugin identity. */
export const name = 'experimental-browser-control'
/** Services required by this browser-only provider. */
export const inject = ['browserUse', 'agents', 'tools', 'systemPrompt']

/** Saved browser defaults, live approval, and display capture pacing. */
export interface Config {
  /** Ask before each browser mutation; changes apply to existing Sessions. */
  requireInputApproval: Volatile<boolean>
  /** Installed browser distribution, independent of the user's normal profile. */
  browserChannel: Volatile<'chrome' | 'chromium' | 'msedge'>
  /** Viewport width in CSS pixels. */
  browserViewportWidth: Volatile<number>
  /** Viewport height in CSS pixels. */
  browserViewportHeight: Volatile<number>
  /** Include model-visible images; picture-in-picture remains independent. */
  screenshots: Volatile<boolean>
  /** Pointer and drag duration in milliseconds. */
  cursorMoveDurationMs: Volatile<number>
  /** Browser scroll duration in milliseconds. */
  scrollDurationMs: Volatile<number>
  /** Delay between text characters in milliseconds. */
  typingDelayMs: Volatile<number>
  /** Idle lifetime of preview input indicators in milliseconds. */
  overlayIdleMs: Volatile<number>
  /** Delay between preview captures in milliseconds. */
  previewIntervalMs: Volatile<number>
  /** Delay between captures during input feedback in milliseconds. */
  previewActiveIntervalMs: Volatile<number>
  /** Delay between checks without an active target in milliseconds. */
  previewIdleIntervalMs: Volatile<number>
  /** Elapsed deadline for input and observation in milliseconds. */
  operationTimeoutMs: Volatile<number>
  /** Elapsed deadline for browser startup and navigation in milliseconds. */
  navigationTimeoutMs: Volatile<number>
}

// The config catalog requires literal keys for each plugin’s independent settings.
/* jscpd:ignore-start */
/** Browser rendering stays hidden; viewport and timing defaults are configurable. */
export const Config = Schema.object({
  requireInputApproval: Schema.boolean().default(false).volatile(),
  browserChannel: Schema.union(['chrome', 'chromium', 'msedge']).default('chrome').volatile(),
  browserViewportWidth: Schema.number().step(1).min(320).max(3840).default(1440).volatile(),
  browserViewportHeight: Schema.number().step(1).min(200).max(2160).default(900).volatile(),
  screenshots: Schema.boolean().default(false).volatile(),
  cursorMoveDurationMs: Schema.number().step(1).min(0).max(5000).default(450).volatile(),
  scrollDurationMs: Schema.number().step(1).min(0).max(5000).default(650).volatile(),
  typingDelayMs: Schema.number().step(1).min(0).max(200).default(45).volatile(),
  overlayIdleMs: Schema.number().step(1).min(100).max(60_000).default(1600).volatile(),
  previewIntervalMs: Schema.number().step(1).min(250).max(10_000).default(250).volatile(),
  previewActiveIntervalMs: Schema.number().step(1).min(40).max(1000).default(80).volatile(),
  previewIdleIntervalMs: Schema.number().step(1).min(250).max(30_000).default(2000).volatile(),
  operationTimeoutMs: Schema.number().step(1).min(1).max(2 ** 31 - 1).default(15_000).volatile(),
  navigationTimeoutMs: Schema.number().step(1).min(1).max(2 ** 31 - 1).default(30_000).volatile(),
})
/* jscpd:ignore-end */

/**
 * Mount a browser-only runtime with independent approval and preview ownership.
 * @param ctx - context with browser, Agent, tool, and prompt services.
 * @param config - live settings owned by this bundle.
 * @returns after registration; the first browser action starts Playwright.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const preview = ComputerPreviewSources.mount(ctx, BrowserPreviewController, config)
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  await mountComputerControl(ctx, () => ProviderConfig({
    inputMode: 'background', nativeBackground: false, headless: true, showOverlay: true,
    requireInputApproval: config.requireInputApproval.get(),
    browserChannel: config.browserChannel.get(),
    browserViewportWidth: config.browserViewportWidth.get(), browserViewportHeight: config.browserViewportHeight.get(),
    screenshots: config.screenshots.get(), cursorMoveDurationMs: config.cursorMoveDurationMs.get(),
    scrollDurationMs: config.scrollDurationMs.get(), typingDelayMs: config.typingDelayMs.get(),
    overlayIdleMs: config.overlayIdleMs.get(), operationTimeoutMs: config.operationTimeoutMs.get(),
    navigationTimeoutMs: config.navigationTimeoutMs.get(),
  }), (sessionId, capture) => preview.register(sessionId, capture), 'browser')
}
