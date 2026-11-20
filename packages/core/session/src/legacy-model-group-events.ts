/**
 * Payloads stored by the retired Model groups bundle.
 * @module
 */
import type { SessionId, SessionSeq } from './types.ts'
import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Conversation-local execution mode.
 */
export type ModelGroupMode = 'single' | 'multi'

/** Accepted model input and the identities used by its subsequent settlement notice. */
export interface ModelGroupDispatchReceipt {
  readonly member: string
  readonly sessionId: SessionId
  readonly taskId?: Branded<'TeamTaskId'>
  readonly accepted: true
}

/** Accepted executions and unconfirmed recipients for one public direct message. */
export interface ModelGroupDelivery {
  readonly requestSeq: SessionSeq
  readonly accepted: readonly ModelGroupDispatchReceipt[]
  readonly failed: readonly string[]
  /** The request sequence identifies an ordinary user/message; absence retains a legacy public post. */
  readonly publicMessage?: true
}

/**
 * A named exact model route; strengths guide assignment without fixing its role.
 */
export interface ModelGroupMember {
  /** Unique lowercase model alias used in mentions and task assignment. */
  readonly name: string
  /** Model name shown in the group roster and public replies. */
  readonly label: string
  /** Registered LLM provider route. */
  readonly provider: string
  /** Provider-owned exact model identifier. */
  readonly model: string
  /** User-authored task strengths used by the leader when choosing models. */
  readonly strengths: string
}

/**
 * Recorded conversation configuration and execution state.
 */
export interface ModelGroupSnapshot {
  readonly mode: ModelGroupMode
  readonly leader: string
  readonly members: readonly ModelGroupMember[]
  readonly stopped: boolean
  readonly direct: readonly string[]
  readonly stoppedMembers: readonly string[]
}

/**
 * A member's public message, linked to its independently persisted execution record.
 */
export interface ModelGroupPost {
  readonly member: string
  readonly label: string
  readonly text: string
  readonly sourceSession: SessionId
  readonly sourceSeq?: SessionSeq
  readonly failure?: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Conversation configuration recorded by the retired Model groups bundle. */
    'model-group/configured': ModelGroupSnapshot
    /** Recorded group stop state. */
    'model-group/stopped': { readonly stopped: boolean }
    /** Recorded ownership of the latest delivery to a member. */
    'model-group/delivery': { readonly member: string; readonly direct: boolean }
    /** Recorded interruption of a member. */
    'model-group/member-stopped': { readonly member: string }
    /** Recorded public member output or direct human message. */
    'model-group/post': ModelGroupPost
    /** Recorded acceptance or lack of confirmation for each recipient of a direct message. */
    'model-group/dispatched': ModelGroupDelivery
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Historical receipt notice stored in the leader's inbox; it does not request a reply. */
    'model-group': { readonly kind: 'model-group'; readonly form: 'notice'; readonly summary: string }
  }
}
