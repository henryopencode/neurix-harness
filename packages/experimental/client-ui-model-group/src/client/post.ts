/**
 * Group posts rendered at their committed position in the ordinary Chat timeline.
 * @module
 */
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ModelGroupDelivery, ModelGroupPost } from '../types.ts'

// Order a receipt after its human input and before later integer Session sequences.
const DELIVERY_ACK_OFFSET = 0.01

/** Public text and its direct-delivery receipt, folded from the root log. */
export interface GroupPostView extends ModelGroupPost {
  readonly delivery?: ModelGroupDelivery
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'model-group-post': GroupPostView
    'model-group-delivery': ModelGroupDelivery
  }
}

/**
 * Each public post has a stable root-log identity and a member execution reference.
 */
export const groupPostDefinition: ConversationNodeDefinition<GroupPostView> = {
  kind: 'model-group-post', target: 'chat',
  match: event => event.type === 'model-group/post' ? { id: String(event.seq), role: 'start' }
    : event.type === 'model-group/dispatched' && event.data.publicMessage !== true ? { id: String(event.data.requestSeq), role: 'update' } : null,
  start: (_context, match) => {
    if (match.event.type !== 'model-group/post') throw new Error('Model-group post expected')
    return match.event.data
  },
  update: (context, match) => match.event.type === 'model-group/dispatched'
    ? { ...context.state, delivery: match.event.data } : context.state,
  buildViewNode: (context) => {
    const first = context.start ?? context.matches[0]
    if (first === undefined || context.state === undefined) return null
    return {
      key: context.key, kind: 'model-group-post', id: context.id, target: 'chat',
      anchorSeq: first.event.seq, location: first.location, visibility: 'visible',
      groupTree: context.state.member === 'user' ? 'input'
        : context.state.sourceSeq === undefined && context.state.failure === undefined ? undefined : 'turn', data: context.state,
    } satisfies ChatNode<'model-group-post'>
  },
}

/** Delivery acknowledgement follows its ordinary human input, independently of Agent turns. */
export const groupDeliveryDefinition: ConversationNodeDefinition<ModelGroupDelivery> = {
  kind: 'model-group-delivery', target: 'chat',
  match: event => event.type === 'model-group/dispatched' && event.data.publicMessage === true
    ? { id: String(event.seq), role: 'start' } : null,
  start: (_context, match) => {
    if (match.event.type !== 'model-group/dispatched') throw new Error('Model-group delivery expected')
    return match.event.data
  },
  update: context => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return {
      key: context.key, kind: 'model-group-delivery', id: context.id, target: 'chat',
      anchorSeq: context.state.requestSeq + DELIVERY_ACK_OFFSET, location: { kind: 'session' },
      visibility: 'visible', groupTree: 'input', data: context.state,
    } satisfies ChatNode<'model-group-delivery'>
  },
}
