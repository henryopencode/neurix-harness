/** Browser-owned continuous wheel gestures without per-frame Host round trips. @module */

import type { Page } from 'playwright'
import type { ComputerInput } from './schema.ts'

/**
 * Deliver a continuous browser wheel gesture without changing DOM scroll offsets.
 * The caller closes the owned browser if cancellation interrupts active input;
 * this helper always withdraws its CDP session before settling.
 * @param page - exact owned page receiving wheel input.
 * @param point - current visible wheel location in viewport CSS pixels.
 * @param input - validated direction and distance.
 * @param durationMs - target gesture duration; zero sends one immediate event.
 * @param signal - caller-owned input cancellation.
 * @returns after browser gesture completion and CDP withdrawal.
 */
export async function scrollBrowserPage(
  page: Page, point: { x: number; y: number }, input: Pick<Extract<ComputerInput, { action: 'scroll' }>, 'direction' | 'amount'>,
  durationMs: number, signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  if (durationMs === 0) {
    await page.mouse.wheel(input.direction === 'left' ? -input.amount : input.direction === 'right' ? input.amount : 0,
      input.direction === 'up' ? -input.amount : input.direction === 'down' ? input.amount : 0)
    signal.throwIfAborted()
    return
  }
  const session = await page.context().newCDPSession(page)
  try {
    signal.throwIfAborted()
    await session.send('Input.synthesizeScrollGesture', {
      ...point,
      xDistance: input.direction === 'left' ? input.amount : input.direction === 'right' ? -input.amount : 0,
      yDistance: input.direction === 'up' ? input.amount : input.direction === 'down' ? -input.amount : 0,
      speed: Math.max(1, Math.round(input.amount * 1000 / durationMs)),
      gestureSourceType: 'mouse', preventFling: true,
    })
    signal.throwIfAborted()
  } finally {
    try { await session.detach() } catch (error) {
      // Closing the page already withdraws its CDP session during input cancellation.
      if (!page.isClosed()) throw error
    }
  }
}
