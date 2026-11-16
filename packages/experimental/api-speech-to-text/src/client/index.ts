/** Shared browser transcription Remote; independent voice controls borrow this namespace. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import speechRemote from '@deepseek-ai/dsh-experimental-api-speech-to-text/remote'

/** Gateway that owns the generated optional namespace. */
export const inject = ['remote']

/**
 * Mount transcription once for every selected speech consumer.
 * @param ctx - shared API plugin lifetime.
 * @returns disposer withdrawing the namespace after its consumers unload.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> { return await ctx.remote.$mount(speechRemote) }
