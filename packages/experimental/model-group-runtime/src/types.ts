/**
 * Model-group configuration and replayable, browser-safe records.
 * @module
 */
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
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
 * Conversation configuration; unused conversations may refresh members from live defaults.
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
    /**
     * Whole conversation-local group selection; log-only.
     */
    'model-group/configured': ModelGroupSnapshot
    /**
     * Group stop state, preventing new assignments until the next human message; log-only.
     */
    'model-group/stopped': { readonly stopped: boolean }
    /**
     * Most recent delivery ownership for one member; log-only.
     */
    'model-group/delivery': { readonly member: string; readonly direct: boolean }
    /** Human interruption prevents automatic reassignment until a later human request. */
    'model-group/member-stopped': { readonly member: string }
    /**
     * Publicly posted member output or direct human message; log-only.
     */
    'model-group/post': ModelGroupPost
    /** Direct-message acceptance linked to its public input; task settlement owns completion. Log-only. */
    'model-group/dispatched': ModelGroupDelivery
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * Per-conversation model-group selection and control state.
     */
    modelGroup: ModelGroupSnapshot | null
  }
}
