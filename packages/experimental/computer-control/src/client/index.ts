/** Computer-control browser entry with an optional display-only Remote. @module */

import type { Context } from '@deepseek-ai/cordis'
import contribution from '@deepseek-ai/dsh-experimental-computer-control/remote'
import { mountComputerControlUi } from './mount.ts'
export { inject } from './mount.ts'

/**
 * Register editable defaults and the target preview.
 * @param ctx - browser plugin context.
 * @returns disposer joining UI, capture requests, and Remote withdrawal.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountComputerControlUi(ctx, contribution)
}
