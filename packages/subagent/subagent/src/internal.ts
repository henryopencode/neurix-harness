/** Host-authored continuation delivery without the model-message framing used by send_message. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, MessageId, MessageSource } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type SubagentRuntime from './index.ts'

/** Shared identity of the runtime's host-only delivery capability across bundled and unbundled modules. */
export const deliverSubagentPrompt = Symbol.for('dsh.subagent.deliverPrompt')

/**
 * Steer an admitted host prompt while preserving its durable source and content.
 * @param runtime - continuation lifecycle owner.
 * @param root - exact live tree root authorizing delivery.
 * @param childId - target root or continuable member in that tree.
 * @param content - already-admitted durable content.
 * @param source - host-established message attribution.
 * @param signal - cancellation before inbox acceptance.
 * @returns the accepted inbox message identity; later execution is independent.
 */
export function steerHostSubagentPrompt(
  runtime: SubagentRuntime, root: Agent, childId: SessionId, content: ContentBlock[], source: MessageSource, signal: AbortSignal,
): Promise<MessageId> {
  return runtime[deliverSubagentPrompt](root, childId, content, source, signal)
}
