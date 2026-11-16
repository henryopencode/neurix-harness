/** Browser entry for the optional speech Remote contribution and composer control. */
import type { Context } from '@deepseek-ai/cordis'
import { mountVoiceInput } from './mount.ts'

export { inject } from './mount.ts'

/**
 * Activate the experimental microphone contribution.
 * @param ctx - Client runtime.
 * @returns complete microphone and UI disposer.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountVoiceInput(ctx)
}
