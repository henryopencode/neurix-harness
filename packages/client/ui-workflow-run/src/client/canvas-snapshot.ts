/** Incremental canvas index over planned tasks and independent workflow runs. */
import type { ConversationViewDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WorkflowCanvasNode, WorkflowGraph, WorkflowSnapshot, WorkflowTask } from './canvas-contract.ts'
import type { WorkflowRunStatus } from './workflow-definition.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Stable snapshot for a Session with no loaded plans or runs. */
export const EMPTY_WORKFLOW: WorkflowSnapshot = { graphs: [], executions: {} }

/** Canvas target retains one current plan per Turn and every loaded run. */
export const workflowCanvasView: ConversationViewDefinition<WorkflowCanvasNode, WorkflowSnapshot> = {
  target: 'workflow',
  create: () => {
    const memberships = new Map<string, string>()
    const candidates = new Map<string, Map<string, WorkflowGraph>>()
    const graphs = new Map<string, WorkflowGraph>()
    let current = EMPTY_WORKFLOW
    const accept = (nodes: readonly WorkflowCanvasNode[]): WorkflowSnapshot => {
      if (nodes.length === 0) return current
      const executions = { ...current.executions }
      const refresh = (id: string): void => {
        let latest: WorkflowGraph | undefined
        for (const candidate of (candidates.get(id) as Map<string, WorkflowGraph>).values()) {
          if (latest === undefined
            || (candidate.source === 'plan' && latest.source === 'turn')
            || (candidate.source === latest.source && candidate.seq > latest.seq)) latest = candidate
        }
        if (latest === undefined) { candidates.delete(id); graphs.delete(id) }
        else graphs.set(id, latest)
      }
      for (const { key, data: graph } of nodes) {
        const previous = memberships.get(key)
        if (previous !== undefined && previous !== graph.id) {
          (candidates.get(previous) as Map<string, WorkflowGraph>).delete(key)
          refresh(previous)
        }
        memberships.set(key, graph.id)
        let group = candidates.get(graph.id)
        if (group === undefined) { group = new Map(); candidates.set(graph.id, group) }
        group.set(key, graph)
        refresh(graph.id)
        if (graph.source !== 'run') continue
        for (const task of graph.tasks) {
          if (task.sessionId === undefined) continue
          const seq = task.executionSeq ?? graph.seq
          const previousExecution = Object.hasOwn(executions, task.sessionId) ? executions[task.sessionId] : undefined
          if (seq < (previousExecution?.seq ?? -1)) continue
          Object.defineProperty(executions, task.sessionId, {
            value: { status: task.status as WorkflowRunStatus, seq }, enumerable: true, writable: true, configurable: true,
          })
        }
      }
      current = {
        graphs: [...graphs.values()].sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id)),
        executions,
      }
      return current
    }
    return {
      empty: EMPTY_WORKFLOW,
      replace: ({ nodes }) => {
        memberships.clear(); candidates.clear(); graphs.clear()
        current = EMPTY_WORKFLOW
        return accept(nodes)
      },
      apply: ({ upserts }) => accept(upserts),
    }
  },
}

/**
 * Read only recorded member entries for an explicitly linked child.
 * @param executions - current durable execution states.
 * @param sessionId - child reference supplied by the plan.
 * @param since - latest plan update; older execution facts cannot settle newly planned work.
 * @returns recorded state, or undefined when that child has no execution evidence.
 */
export function workflowExecutionStatus(
  executions: WorkflowSnapshot['executions'],
  sessionId: SessionId | undefined,
  since: number,
): WorkflowRunStatus | undefined {
  const recorded = sessionId !== undefined && Object.hasOwn(executions, sessionId) ? executions[sessionId] : undefined
  return recorded !== undefined && recorded.seq >= since ? recorded.status : undefined
}

/**
 * Resolve execution evidence and explicit prerequisites without inventing dependencies.
 * @param graph - current task plan or run.
 * @param executions - durable outcomes of explicitly linked child Sessions.
 * @returns tasks with their current displayed status.
 */
export function resolveWorkflowTasks(
  graph: WorkflowGraph,
  executions: WorkflowSnapshot['executions'],
): readonly WorkflowTask[] {
  if (graph.source !== 'plan') return graph.tasks
  const tasks = graph.tasks.map((task) => {
    const execution = workflowExecutionStatus(executions, task.sessionId, graph.seq)
    return execution === undefined ? task : { ...task, status: execution }
  })
  const byId = new Map(tasks.map(task => [task.id, task]))
  return tasks.map((task) => {
    if (task.status !== 'pending') return task
    if (task.blockedReason !== undefined) return { ...task, status: 'blocked' }
    let waiting = false
    for (const id of task.dependsOn) {
      const dependency = byId.get(id)
      if (dependency === undefined || ['failed', 'cancelled', 'interrupted', 'removed', 'blocked'].includes(dependency.status)) {
        return { ...task, status: 'blocked' }
      }
      if (dependency.status !== 'completed') waiting = true
    }
    return waiting ? { ...task, status: 'waiting' } : task
  })
}
