/** Browser entry for optional local realtime voice conversations. */
import type { Context } from '@deepseek-ai/cordis'
import remote from '@deepseek-ai/dsh-voice-chat/remote'
import { mountVoiceChat } from './mount.ts'

export { inject } from './mount.ts'

/**
 * Activate voice controls without downloading models or acquiring a microphone.
 * @param ctx - Client plugin context.
 * @returns joined UI, recording, and Remote disposer.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> { return await mountVoiceChat(ctx, remote) }
