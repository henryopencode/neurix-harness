/** Durable abandonment facts shared by task plans and workflow runs. */
import type { ConversationLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'

/**
 * Locate the fact that closes inherited or crashed work without claiming ordinary completion.
 * @param location - resolved owner of the planned or executed work.
 * @returns the crash or fork closure's sequence, or undefined without such a fact.
 */
export function abandonedTurnSeq(location: ConversationLocation): SessionSeq | undefined {
  if (location.kind !== 'step' && location.kind !== 'turn') return undefined
  const end = location.turn.end
  return end?.data.reason.kind === 'interrupted' || end?.data.reason.kind === 'forked' ? end.seq : undefined
}
