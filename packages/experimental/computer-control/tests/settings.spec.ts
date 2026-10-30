/** The bundle resolves new defaults without mutating an existing Session's admitted values. */

import { Context } from '@deepseek-ai/cordis'
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import { expect, it, vi } from 'vitest'
import { Config as ProviderConfig, mountComputerControl } from '@deepseek-ai/dsh-experimental-computer-use-unified'
import * as bundle from '../src/index.ts'

vi.mock('@deepseek-ai/dsh-experimental-computer-use-unified', async (original) => {
  const actual = await original<typeof import('@deepseek-ai/dsh-experimental-computer-use-unified')>()
  return { ...actual, mountComputerControl: vi.fn(() => Promise.resolve()) }
})

it('keeps application input in the foreground and excludes browser settings', async () => {
  const ctx = new Context()
  const config = {
    requireInputApproval: createVolatile(false),
    inputMode: 'background',
    keySettleMs: createVolatile(300),
    showOverlay: createVolatile(true),
    cursorMoveDurationMs: createVolatile(450), scrollDurationMs: createVolatile(650),
    typingDelayMs: createVolatile(45), overlayIdleMs: createVolatile(1600),
    previewIntervalMs: createVolatile(250), previewActiveIntervalMs: createVolatile(80),
    previewIdleIntervalMs: createVolatile(2000),
    screenshots: createVolatile(false),
    operationTimeoutMs: createVolatile(15_000), navigationTimeoutMs: createVolatile(30_000),
    nativeTreeTimeoutMs: createVolatile(5000),
  }
  try {
    await bundle.apply(ctx, config)
    const resolve = vi.mocked(mountComputerControl).mock.calls[0]?.[1]
    if (resolve === undefined) throw new Error('The provider was not mounted')
    const admitted = resolve()
    expect(admitted).toEqual(ProviderConfig({ inputMode: 'foreground', nativeBackground: false, screenshots: false }))
    updateVolatile(config.screenshots, createVolatile(true))
    updateVolatile(config.operationTimeoutMs, createVolatile(20_000))
    updateVolatile(config.navigationTimeoutMs, createVolatile(40_000))
    updateVolatile(config.nativeTreeTimeoutMs, createVolatile(3000))
    expect(resolve()).toMatchObject({ screenshots: true,
      operationTimeoutMs: 20_000, navigationTimeoutMs: 40_000, nativeTreeTimeoutMs: 3000 })
    expect(admitted).toMatchObject({ screenshots: false, operationTimeoutMs: 15_000 })
    expect(vi.mocked(mountComputerControl).mock.calls[0]?.[3]).toBe('applications')
    expect('default' in bundle).toBe(false)
  } finally { await ctx.fiber.dispose() }
})
