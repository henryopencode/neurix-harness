/** Browser entry for phone access to this existing application. @module */
import type { Context } from '@deepseek-ai/cordis'
import contribution from '@deepseek-ai/dsh-experimental-mobile-access/remote'
import { mountMobileAccess } from './mount.ts'
export { inject } from './mount.ts'

/**
 * Register phone connection settings in this Client.
 * @param ctx - running application Client.
 * @returns contribution withdrawal.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountMobileAccess(ctx, contribution)
}
