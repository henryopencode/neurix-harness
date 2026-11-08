/** Task plans and recorded executions consumed by the workflow canvas. */
import type { ConversationViewNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import type { WorkflowRunStatus } from './workflow-definition.ts'

/** Visible state of one planned or executed task. */
export type WorkflowTaskStatus = WorkflowRunStatus | 'pending' | 'waiting' | 'blocked' | 'removed'

/** One task, including steps removed by a later plan revision. */
export interface WorkflowTask {
  /** Graph-local display key derived from a todo id, legacy label, or member sequence. */
  readonly id: string
  readonly content: string
  readonly status: WorkflowTaskStatus
  readonly phase?: string
  readonly description?: string
  readonly expectedOutput?: string
  readonly dependsOn: readonly string[]
  readonly blockedReason?: string
  readonly sessionId?: TodoItem['sessionId']
  readonly result?: string
  readonly artifacts?: readonly string[]
  readonly removed?: boolean
  /** Logical sequence of this member's latest execution event, for paged-history ordering. */
  readonly executionSeq?: number
}

/** One turn's plan or one independently recorded workflow run. */
export interface WorkflowGraph {
  /** Session-local display key derived from a recorded turn or run identity. */
  readonly id: string
  readonly seq: number
  readonly turn?: number
  readonly name?: string
  readonly source: 'plan' | 'run'
  readonly tasks: readonly WorkflowTask[]
}

/** Canvas-owned contribution assembled without reading another View's nodes. */
export interface WorkflowCanvasNode extends ConversationViewNode {
  readonly target: 'workflow'
  readonly data: WorkflowGraph
}

/** Loaded plans and durable execution outcomes for explicitly linked child Sessions. */
export interface WorkflowSnapshot {
  readonly graphs: readonly WorkflowGraph[]
  readonly executions: Readonly<Record<string, { readonly status: WorkflowRunStatus; readonly seq: number }>>
}

/** Registration-private reactive input bound into a framework-made useWorkflow hook. */
export interface WorkflowSourceInjected {
  readonly hooks: { readonly workflow: ObservableSnapshot<WorkflowSnapshot> }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap {
    /** Planned tasks and recorded workflow executions. */
    workflow: WorkflowSnapshot
  }
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Automatically displayed, revision-aware task plan. */
    'workflow-plan': WorkflowGraph
  }
}

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** Restorable identity of one task inspector. */
    'workflow-node': { workflowGraphId: string; workflowTaskId: string }
  }
}
