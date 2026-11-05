/** Bind the generated knowledge Remote to the source-tested browser lifecycle. */

import type { Context } from '@deepseek-ai/cordis'
import contribution from '@deepseek-ai/dsh-experimental-knowledge-base/remote'
import { mountKnowledgeUi } from './mount.ts'

export { inject } from './mount.ts'

/**
 * Expose the sidebar knowledge graph and document management page.
 * @param ctx - Injected Client services.
 * @returns Quiescent UI and Remote withdrawal.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  try { return await mountKnowledgeUi(ctx, contribution) } catch (error) {
    console.error('Knowledge management activation failed', error)
    throw error
  }
}
