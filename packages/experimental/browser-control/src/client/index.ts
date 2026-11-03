/** Browser-control client entry with isolated settings and display preview. @module */

import type { Context } from '@deepseek-ai/cordis'
import contribution from '@deepseek-ai/dsh-experimental-browser-control/remote'
import { mountBrowserControlUi } from './mount.ts'
export { inject } from './mount.ts'

/**
 * Register browser settings and a preview of its hidden browser.
 * @param ctx - client plugin context.
 * @returns disposer joining UI and Remote withdrawal.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountBrowserControlUi(ctx, contribution)
}
