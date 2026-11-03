/** Public Agent Teams identities, durable records, and service request values. */

import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { AgentOptions } from '@deepseek-ai/dsh-agent/types'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { Volatile } from '@deepseek-ai/cordis'

/** One available model; responsibilities belong to teammates rather than model entries. */
export interface TeamModel {
  /** Unique alias selected by the Lead when creating a responsibility. */
  readonly name: string
  /** Display name in Team settings and attributed replies. */
  readonly label: string
  /** Registered LLM provider route. */
  readonly provider: string
  /** Exact provider-owned model identifier. */
  readonly model: string
  /** User-authored task guidance for model selection. */
  readonly strengths: string
}

/** Model choices captured for one Team, independent of its role roster. */
export interface TeamModelSelection {
  /** Candidate alias initially assigned to the Lead. */
  readonly leader: string
  /** Model pool captured for this Team. */
  readonly models: readonly TeamModel[]
}

/** Public teammate output retains both its responsibility and actual model route. */
export interface TeamPost {
  /** Responsibility name from the Team roster. */
  readonly member: string
  /** Delegated responsibility description. */
  readonly description: string
  /** Actual model recorded on the assistant response. */
  readonly model: string
  /** Candidate display label, or the actual model id when no label matches. */
  readonly label: string
  /** Public assistant text. */
  readonly text: string
  /** Member Session that produced the output. */
  readonly sourceSession: SessionId
  /** Original assistant-message sequence, absent for a terminal failure notice. */
  readonly sourceSeq?: SessionSeq
  /** Terminal outcome when no complete reply was returned. */
  readonly failure?: string
}

/** Identifies the implicit team rooted at one top-level Session. */
export type TeamId = Branded<'TeamId'>

/**
 * Brand one root Session identity as its implicit Team identity.
 * @param id - Root Session identity.
 * @returns the same string branded as a Team identity.
 */
export function TeamId(id: SessionId | string): TeamId {
  return id as TeamId
}

/** Stable identifier for one task in a Team. */
export type TeamTaskId = Branded<'TeamTaskId'>

/**
 * Brand a validated task id.
 * @param id - Team-local task identity.
 * @returns the same string branded as a Team task identity.
 */
export function TeamTaskId(id: string): TeamTaskId {
  return id as TeamTaskId
}

/** Stable identifier for one durable peer message. */
export type TeamMessageId = Branded<'TeamMessageId'>

/**
 * Brand a generated peer-message id.
 * @param id - Durable mailbox message identity.
 * @returns the same string branded as a Team message identity.
 */
export function TeamMessageId(id: string): TeamMessageId {
  return id as TeamMessageId
}

/** Durable teammate lifecycle. */
export type TeamMemberPhase = 'provisioning' | 'active' | 'failed'

/** Whole durable value written on every teammate lifecycle change. */
export interface TeamMemberSnapshot {
  readonly id: SessionId
  readonly name: string
  readonly description: string
  readonly provider: string
  readonly context: 'fresh' | 'fork'
  /** Immutable coordination namespace that created this member; omission leaves it unassigned to a coordinator. */
  readonly coordinationOwner?: string
  readonly phase: TeamMemberPhase
  readonly error?: string
}

/** Current runtime-enriched roster row. */
export interface TeamMemberView {
  readonly id: SessionId
  readonly name: string
  readonly role: 'lead' | 'teammate'
  readonly status: 'running' | 'inactive' | 'provisioning' | 'failed'
  readonly description?: string
  readonly provider?: string
  readonly context?: 'fresh' | 'fork'
  /** Coordination namespace that created this member. */
  readonly coordinationOwner?: string
  /** Current selection of the live Agent; absent when no live model selection is available. */
  readonly model?: string
  readonly diagnostics: string[]
}

/** Durable task lifecycle. */
export type TeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

/** Whole durable task snapshot; every mutation increments {@link revision}. */
export interface TeamTaskSnapshot {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly ownerId?: SessionId
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
}

/** Runtime-enriched task view returned to tools and hosts. */
export interface TeamTaskView {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
  readonly ownerName?: string
  readonly ready: boolean
  readonly writeScopeWarnings: string[]
}

/** One durable roster row published through the `agentTeam` Session projection. */
export interface TeamMemberProjection {
  readonly id: SessionId
  readonly name: string
  readonly role: 'lead' | 'teammate'
  /** Durable lifecycle; the Lead row is always `active`. Turn activity comes from Session status. */
  readonly phase: TeamMemberPhase
  /** Coordination namespace that created this member. */
  readonly coordinationOwner?: string
  readonly error?: string
}

/**
 * Durable Team state published to browser clients through the Lead Session's
 * `agentTeam` projection. `failure` names the first rejected persisted Team
 * record; members and tasks then stay at the last valid state.
 */
export interface TeamProjection {
  readonly members: TeamMemberProjection[]
  readonly tasks: TeamTaskView[]
  readonly failure?: string
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Configured model candidates and selected leader for one Team. */
    teamModels: TeamModelSelection | null
    /** Durable roster and non-deleted task board of the Team rooted at the projected Session. */
    agentTeam: TeamProjection
  }
}

/** One peer message recorded by the historical Team mailbox. */
export interface TeamMessageSnapshot {
  readonly id: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  readonly targetId: SessionId
  readonly content: ContentBlock[]
}

/** Source recorded by a target Session for one historical Team mailbox delivery. */
export interface TeamMessageSource {
  readonly kind: 'team-message'
  readonly teamId: TeamId
  readonly messageId: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'team-message': TeamMessageSource
  }
}

/** Team-service deployment limits. */
export interface Config {
  /** Candidate model routes and strengths; empty retains inherited model selection. */
  readonly models?: Volatile<TeamModel[]>
  /** Candidate alias used by the Lead; empty preserves the Lead's current selection. */
  readonly leaderModel?: Volatile<string>
  /** Maximum simultaneously active teammates per Team. */
  readonly maxParallel?: Volatile<number>
  /** Maximum immutable teammate names retained by one Team. */
  readonly maxMembers?: number
  /** Maximum non-deleted tasks retained by one Team. */
  readonly maxTasks?: number
  /** Maximum UTF-8 bytes in one complete sender-framed delivery. */
  readonly maxMessageBytes?: number
  /** Maximum milliseconds for shared operation settlement and for each Team child drain. */
  readonly disposalTimeoutMs?: number
}

/** Input for creating one durable teammate. */
export interface SpawnTeammateRequest {
  readonly name: string
  readonly description: string
  readonly prompt: ContentBlock[]
  readonly context: 'fresh' | 'fork'
  readonly provider: string
  /** Configured model alias chosen for this responsibility; required when model candidates are configured. */
  readonly model?: string
  /** Explicit child model route and request controls supported by the execution provider. */
  readonly agentOptions?: AgentOptions
  /** Immutable coordination namespace retained with the member. */
  readonly coordinationOwner?: string
  readonly signal: AbortSignal
}

/** Result after one teammate reaches a durable active or failed edge. */
export interface SpawnTeammateResult {
  readonly member: TeamMemberView
}

/** Input for one direct peer-message attempt. */
export interface SendTeamMessageRequest {
  readonly target: string
  readonly content: ContentBlock[]
  readonly signal: AbortSignal
}

/** Target inbox acceptance under ordinary Agent persistence; no Team retry or deduplication. */
export interface SendTeamMessageResult {
  readonly messageId: MessageId
}

/** Input for creating one shared task. */
export interface CreateTeamTaskRequest {
  readonly subject: string
  readonly description: string
  readonly blockedBy?: readonly TeamTaskId[]
  readonly writeScopes?: readonly string[]
}

/** Supported task mutation actions. */
export type TeamTaskAction =
  | 'claim'
  | 'release'
  | 'edit'
  | 'set_dependencies'
  | 'complete'
  | 'reopen'
  | 'reassign'
  | 'delete'

/** Compare-and-set mutation of one shared task. */
export interface UpdateTeamTaskRequest {
  readonly taskId: TeamTaskId
  readonly expectedRevision: number
  readonly action: TeamTaskAction
  readonly subject?: string
  readonly description?: string
  readonly blockedBy?: readonly TeamTaskId[]
  readonly writeScopes?: readonly string[]
  readonly owner?: string
}

/** Result of waiting for Team activity. */
export interface TeamWaitResult {
  readonly timedOut: boolean
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Candidate models and Lead selection captured before Team execution. */
    'team/models': TeamModelSelection
    /** Human stop control; later human input reopens collaboration. */
    'team/control': { readonly stopped: boolean; readonly stoppedMembers: readonly string[] }
    /** Attributed teammate output at its committed root-conversation position. */
    'team/post': TeamPost
    /** Whole teammate lifecycle value, stored only in the Team Lead Session. */
    'team/member': { version: 2; teamId: TeamId; member: TeamMemberSnapshot }
    /** Whole shared-task value, stored only in the Team Lead Session. */
    'team/task': { version: 2; teamId: TeamId; task: TeamTaskSnapshot }
    /** Historical mailbox enqueue; new sends use the target Agent inbox. */
    'team/message/queued': { version: 2; teamId: TeamId; message: TeamMessageSnapshot }
    /** Historical acknowledgement that the target Session recorded a queued message. */
    'team/message/delivered': {
      version: 2
      teamId: TeamId
      messageId: TeamMessageId
      targetId: SessionId
    }
  }
}
