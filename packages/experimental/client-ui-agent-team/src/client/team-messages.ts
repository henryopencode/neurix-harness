/** Team transcript rows derived from the existing Chat target, without Turn grouping. */
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { AssistantBlock, MessageImageSource, ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TeamMemberProjection } from '@deepseek-ai/dsh-experimental-agent-team/client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

interface MessageIdentity {
  readonly id: string
  readonly sessionId: SessionId
  readonly senderId: SessionId
  readonly user: boolean
  readonly time: number
  readonly seq: number
}

/** Each reply and Tool call has its own stable row across streaming and settlement. */
export type TeamMessage = MessageIdentity & (
  | { readonly kind: 'input'; readonly content: readonly ContentBlock[]; readonly pending: boolean; readonly previews?: readonly MessageImageSource[] }
  | { readonly kind: 'reply'; readonly blocks: readonly AssistantBlock[]; readonly streaming: boolean; readonly interrupted: boolean }
  | { readonly kind: 'thinking' }
  | { readonly kind: 'tool'; readonly block: ToolCallBlock }
  | { readonly kind: 'error'; readonly text: string }
)

function sourceField(source: unknown, key: string): unknown {
  return typeof source === 'object' && source !== null && key in source
    ? Reflect.get(source, key)
    : undefined
}

function responseBlocks(blocks: readonly AssistantBlock[]): readonly AssistantBlock[] {
  return blocks.filter(block => block.kind !== 'reasoning' && block.kind !== 'tool-call')
}

/**
 * Flatten one member's published Chat nodes; reasoning becomes activity, and nested calls become rows.
 * @param member - roster identity represented by the Session.
 * @param chat - the already assembled Chat target, absent while it activates.
 * @param session - lifecycle and optimistic input from the same Session generation.
 * @param roster - known identities used to attribute peer messages.
 * @returns independently keyed rows in member-local transcript order.
 */
export function teamMessages(
  member: TeamMemberProjection,
  chat: ChatSnapshot | undefined,
  session: SessionSnapshot,
  roster: readonly TeamMemberProjection[],
): readonly TeamMessage[] {
  const rows: TeamMessage[] = []
  const observedInputs = new Set<unknown>()
  const nodes = chat?.nodes.values() ?? []
  const toolSteps = new Set<string>()
  for (const candidate of nodes) {
    if (candidate.kind !== 'tool-call' || candidate.visibility !== 'visible' || candidate.location.kind !== 'step') continue
    toolSteps.add(`${candidate.location.turn.turn}:${candidate.location.step.step}`)
  }
  const identity = (id: string, time: number, seq: number): MessageIdentity => ({
    id: `${member.id}:${id}`, sessionId: member.id, senderId: member.id, user: false, time, seq,
  })
  const addTool = (block: ToolCallBlock, seq: number): void => {
    const time = 'kind' in block ? block.callTime ?? block.time : block.time
    rows.push({ ...identity(`tool:${block.callId}`, time, seq), kind: 'tool', block: { ...block, subCalls: [] } })
    for (const child of block.subCalls) addTool(child, seq)
  }
  for (const candidate of nodes) {
    // Chat's registry is merge-extensible; only transcript kinds participate in the Team view.
    const node = candidate as ChatNode
    switch (node.kind) {
      case 'user':
      case 'steering': {
        const requestId = sourceField(node.data.source, 'rpcId')
        observedInputs.add(requestId)
        rows.push({
          ...identity(`input:${typeof requestId === 'string' ? requestId : node.data.messageId ?? node.key}`, node.data.time, node.anchorSeq),
          kind: 'input', content: node.data.content, pending: false, user: true,
        })
        break
      }
      case 'context':
      case 'turn-trigger': {
        if (sourceField(node.data.source, 'kind') !== 'agent-message') break
        const sender = roster.find(candidate => candidate.id === sourceField(node.data.source, 'senderSessionId'))
        if (sender === undefined) break
        rows.push({
          ...identity(`relay:${node.key}`, node.data.time, node.anchorSeq), senderId: sender.id,
          kind: 'input', content: node.data.content, pending: false,
        })
        break
      }
      case 'assistant-step': {
        const { data } = node
        const blocks = responseBlocks(data.blocks)
        const visible = blocks.some(block => block.kind !== 'text' || block.text.trim() !== '')
        if (!visible && (data.status !== 'running' || toolSteps.has(`${data.turn}:${data.step}`))) break
        const time = node.location.kind === 'step' ? node.location.step.start?.time ?? data.time : data.time
        const base = identity(`reply:${data.turn}:${data.step}`, time, node.anchorSeq)
        rows.push(visible
          ? { ...base, kind: 'reply', blocks, streaming: data.status === 'running', interrupted: data.status === 'interrupted' }
          : { ...base, kind: 'thinking' })
        break
      }
      case 'tool-call':
        if (node.visibility === 'visible') addTool(node.data.root, node.anchorSeq)
        break
      case 'turn-error':
        rows.push({ ...identity(`error:${node.key}`, node.data.time, node.anchorSeq), kind: 'error', text: node.data.message })
        break
      default:
        // Controls, model context, and plugin-owned disclosures remain in their existing Views.
        break
    }
  }
  rows.sort((left, right) => left.seq - right.seq || left.time - right.time || left.id.localeCompare(right.id))
  const lastTurn = chat?.timeline.turns.get(chat.timeline.turnOrder.at(-1) ?? -1)
  const step = lastTurn?.steps.at(-1)
  if (session.running && lastTurn?.status === 'open' && step?.status === 'open'
    && !toolSteps.has(`${lastTurn.turn}:${step.step}`)
    && !rows.some(row => row.id === `${member.id}:reply:${lastTurn.turn}:${step.step}`)) {
    rows.push({
      ...identity(`reply:${lastTurn.turn}:${step.step}`, step.start?.time ?? 0,
        Math.max(step.start?.seq ?? 0, rows.at(-1)?.seq ?? 0) + 0.5),
      kind: 'thinking',
    })
  }
  let previousTime = 0
  for (const [index, row] of rows.entries()) {
    previousTime = Math.max(previousTime, row.time)
    if (row.time !== previousTime) rows[index] = { ...row, time: previousTime }
  }
  for (const submission of session.pendingSubmissions) {
    if (submission.placement === 'queued' || observedInputs.has(submission.requestId)) continue
    const content: ContentBlock[] = [{ type: 'text', text: submission.text }]
    const previews: MessageImageSource[] = []
    for (const attachment of submission.attachments) {
      if (attachment.type === 'file') content.push({ type: 'file', attachment: attachment.value })
      else previews.push({ preview: { url: attachment.value.previewUrl,
        ...attachment.value.name === undefined ? {} : { name: attachment.value.name },
        ...attachment.value.width === undefined ? {} : { width: attachment.value.width },
        ...attachment.value.height === undefined ? {} : { height: attachment.value.height },
      } })
    }
    rows.push({
      ...identity(`input:${submission.requestId}`, submission.time, Number.MAX_SAFE_INTEGER),
      kind: 'input', pending: true, user: true,
      content, previews,
    })
  }
  return rows
}
