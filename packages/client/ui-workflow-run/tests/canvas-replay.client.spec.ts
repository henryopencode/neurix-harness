/** Replayed, paged, and live task plans share the same canvas projection. */
import { describe, expect, it } from 'vitest'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationNodeDefinition, ConversationStartMatch, ConversationViewDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { WorkflowCanvasNode, WorkflowGraph, WorkflowSnapshot } from '../src/client/canvas-contract.ts'
import { createPlanDefinition } from '../src/client/plan-definition.ts'
import { EMPTY_WORKFLOW, resolveWorkflowTasks, workflowCanvasView } from '../src/client/canvas-snapshot.ts'
import { workflowCanvasRunDefinition } from '../src/client/workflow-definition.ts'
import { layoutWorkflow } from '../src/client/canvas-layout.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

function at(seq: number, type: string, data: unknown): SessionLiveEventEntry {
  return { type: 'event', event: { seq, time: seq * 100, type, data } as SessionEvent }
}

function assembler(entries: readonly SessionLiveEventEntry[], hasMore = false): ConversationNodeAssembler {
  const definitions = [createPlanDefinition('workflow'), workflowCanvasRunDefinition]
  const value = new ConversationNodeAssembler({
    entries: (): readonly ConversationNodeDefinition[] => definitions,
    fallbackEntry: () => undefined,
  }, { entries: (): readonly ConversationViewDefinition[] => [workflowCanvasView] })
  value.replaceWindow(entries, hasMore)
  value.activateTarget('workflow')
  return value
}

function snapshot(value: ConversationNodeAssembler): WorkflowSnapshot {
  value.flush()
  return (value.snapshot('workflow') as WorkflowSnapshot | undefined) ?? EMPTY_WORKFLOW
}

const events = [
  at(1, 'turn/start', { turn: 1 }),
  at(2, 'step/start', { turn: 1, step: 1 }),
  at(3, 'todo/write', { turn: 1, todos: [
    { id: 'research', content: 'Research', status: 'in_progress', phase: 'Prepare' },
    { id: 'build', content: 'Build', status: 'pending', dependsOn: ['research'], expectedOutput: 'A working page' },
  ] }),
  at(4, 'todo/write', { turn: 1, todos: [
    { id: 'research', content: 'Sources verified', status: 'completed', phase: 'Prepare' },
    { id: 'build', content: 'Build', status: 'in_progress', dependsOn: ['research'], expectedOutput: 'A working page', sessionId: 'child' },
  ] }),
  at(5, 'tool-workflow/run-start', { runId: 'run', name: 'Build page' }),
  at(6, 'tool-workflow/agent-start', { runId: 'run', seq: 1, label: 'Implement page', phase: 'Build', childId: 'child' }),
  at(7, 'tool-workflow/agent-end', { runId: 'run', seq: 1, outcome: 'failed' }),
  at(8, 'tool-workflow/run-end', { runId: 'run', stopReason: 'error' }),
]

describe('workflow canvas replay', () => {
  it('recovers identical planned steps and real execution failures from replace, prepend, and append', () => {
    const complete = snapshot(assembler(events))
    const paged = assembler(events.slice(3), true)
    paged.prepend(events.slice(0, 3), false)
    const live = assembler(events.slice(0, 3))
    for (const event of events.slice(3)) live.append(event)
    expect(snapshot(paged)).toEqual(complete)
    expect(snapshot(live)).toEqual(complete)
    const plan = complete.graphs.find(graph => graph.source === 'plan')!
    expect(plan.tasks.map(task => task.id)).toEqual(['id:research', 'id:build'])
    expect(plan.tasks[0]?.content).toBe('Sources verified')
    expect(resolveWorkflowTasks(plan, complete.executions)[1]?.status).toBe('failed')
  })

  it('retains removed steps and restores them under the same identity when they return', () => {
    const value = assembler(events.slice(0, 4))
    value.append(at(9, 'todo/write', { turn: 1, todos: [{ id: 'build', content: 'Build', status: 'pending' }] }))
    expect(snapshot(value).graphs[0]?.tasks.find(task => task.id === 'id:research')?.status).toBe('removed')
    value.append(at(10, 'todo/write', { turn: 1, todos: [{ id: 'research', content: 'Research again', status: 'pending' }] }))
    expect(snapshot(value).graphs[0]?.tasks.filter(task => task.id === 'id:research')).toHaveLength(1)
    expect(snapshot(value).graphs[0]?.tasks.find(task => task.id === 'id:research')?.removed).toBeUndefined()
  })

  it('keeps previous-turn history and selects only the latest legacy checkpoint per turn', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'todo/write', { todos: [{ content: 'Legacy step', status: 'pending' }] }),
      at(3, 'todo/write', { todos: [{ content: 'Legacy step', status: 'completed' }] }),
      at(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      at(5, 'turn/start', { turn: 2 }),
      at(6, 'todo/write', { turn: 2, todos: [{ id: 'new', content: 'Next task', status: 'pending' }] }),
    ])
    expect(snapshot(value).graphs.map(graph => [graph.turn, graph.tasks[0]?.status])).toEqual([[1, 'completed'], [2, 'pending']])
  })

  it('distinguishes unmet prerequisites, explicit waiting reasons, and failed prerequisites', () => {
    const graph: WorkflowGraph = { id: 'plan', seq: 1, source: 'plan', tasks: [
      { id: 'a', content: 'A', status: 'running', dependsOn: [] },
      { id: 'b', content: 'B', status: 'pending', dependsOn: ['a'] },
      { id: 'c', content: 'C', status: 'pending', dependsOn: [], blockedReason: 'Choose a direction' },
      { id: 'd', content: 'D', status: 'failed', dependsOn: [] },
      { id: 'e', content: 'E', status: 'pending', dependsOn: ['d'] },
    ] }
    expect(resolveWorkflowTasks(graph, {}).map(task => task.status)).toEqual(['running', 'waiting', 'blocked', 'failed', 'blocked'])
  })

  it('draws only declared prerequisites and combines cross-stage edges when folding a stage', () => {
    const tasks = [
      { id: 'a', phase: 'Prepare', dependsOn: [] },
      { id: 'b', phase: 'Prepare', dependsOn: [] },
      { id: 'c', phase: 'Build', dependsOn: ['a', 'b'] },
    ]
    const expanded = layoutWorkflow(tasks, [])
    expect(expanded.edges.map(edge => [edge.source, edge.target])).toEqual([['task:a', 'task:c'], ['task:b', 'task:c']])
    expect(layoutWorkflow(tasks, ['Prepare']).edges).toEqual([
      { id: '["phase:Prepare","task:c"]', source: 'phase:Prepare', target: 'task:c' },
    ])
    expect(layoutWorkflow([{ id: 'a', phase: 'One', dependsOn: [] }, { id: 'b', phase: 'Two', dependsOn: [] }], []).edges).toEqual([])
  })

  it('repairs an unresolved legacy Turn without retaining an orphan graph', () => {
    const records = [
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'todo/write', { todos: [{ content: 'Legacy', status: 'pending' }] }),
      at(3, 'todo/write', { todos: [{ content: 'Legacy', status: 'completed' }] }),
    ]
    const partial = assembler(records.slice(2), true)
    expect(snapshot(partial).graphs[0]?.id).toBe('write:3')
    partial.prepend(records.slice(0, 2), false)
    expect(snapshot(partial)).toEqual(snapshot(assembler(records)))
    expect(snapshot(partial).graphs).toHaveLength(1)
  })

  it.each(['interrupted', 'forked'] as const)('shows abandoned planned work as interrupted after %s closure', (kind) => {
    const value = snapshot(assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'todo/write', { turn: 1, todos: [
        { id: 'active', content: 'Active work', status: 'in_progress' },
        { id: 'next', content: 'Dependent work', status: 'pending', dependsOn: ['active'] },
      ] }),
      at(3, 'turn/end', { turn: 1, reason: { kind } }),
    ]))
    const graph = value.graphs[0]!
    expect(resolveWorkflowTasks(graph, value.executions).map(task => task.status)).toEqual(['interrupted', 'blocked'])
  })

  it('preserves newer child outcomes when older history arrives and ignores inherited property names', () => {
    const builder = workflowCanvasView.create()
    const timeline = { turnOrder: [], turns: new Map() }
    const node = (data: WorkflowGraph, key = data.id): WorkflowCanvasNode => ({ key, id: key, kind: 'run', target: 'workflow', data })
    const child = 'constructor' as SessionId
    const newer: WorkflowGraph = { id: 'newer', seq: 10, source: 'run', tasks: [{ id: 'new', content: 'New run', status: 'completed', dependsOn: [], sessionId: child, executionSeq: 10 }] }
    const older: WorkflowGraph = { id: 'older', seq: 2, source: 'run', tasks: [{ id: 'old', content: 'Old run', status: 'running', dependsOn: [], sessionId: child, executionSeq: 2 }] }
    const first = builder.replace({ nodes: [node(newer)], timeline })
    expect(builder.apply({ upserts: [], timeline })).toBe(first)
    const next = builder.apply({ upserts: [node(older), node({ id: 'unlinked', seq: 2, source: 'run', tasks: [
      { id: 'none', content: 'No child published', status: 'pending', dependsOn: [] },
      { id: 'proto', content: 'Opaque child id', status: 'failed', dependsOn: [], sessionId: '__proto__' as SessionId },
    ] })], timeline })
    expect(next.executions[child]).toEqual({ status: 'completed', seq: 10 })
    expect(Object.hasOwn(next.executions, '__proto__')).toBe(true)
    const plan: WorkflowGraph = { id: 'plan', seq: 9, source: 'plan', tasks: [
      { id: 'unbound', content: 'Unbound', status: 'pending', dependsOn: [], sessionId: 'constructor' as SessionId },
      { id: 'missing', content: 'Missing prerequisite', status: 'pending', dependsOn: ['unknown'] },
    ] }
    expect(resolveWorkflowTasks(plan, {})[0]?.status).toBe('pending')
    expect(resolveWorkflowTasks(plan, next.executions)[0]?.status).toBe('completed')
    expect(resolveWorkflowTasks({ ...plan, seq: 11 }, next.executions)[0]?.status).toBe('pending')
    expect(resolveWorkflowTasks(older, next.executions)[0]?.status).toBe('running')
    expect(resolveWorkflowTasks(plan, {})[1]?.status).toBe('blocked')
    const checkpoint: WorkflowGraph = { ...plan, id: 'turn:2', seq: 20 }
    const recovered = builder.apply({ upserts: [node(checkpoint, 'checkpoint-new'), node({ ...checkpoint, seq: 19 }, 'checkpoint-old')], timeline })
    expect(recovered.graphs.find(item => item.id === checkpoint.id)?.seq).toBe(20)
  })

  it('keeps Chat plans unique, hides trivial and legacy writes, and waits for a usable start', () => {
    const definition = createPlanDefinition('chat')
    expect(definition.match(at(0, 'todo/write', { todos: [] }).event)).toBeNull()
    const start: ConversationStartMatch = { event: at(1, 'todo/write', { turn: 1, todos: [{ id: 'a', content: 'A', status: 'pending' }] }).event,
      role: 'start', location: { kind: 'unresolved' } }
    const context = { key: 'plan', kind: definition.kind, id: 'turn:1', matches: [start], start, state: undefined, current: new Map() }
    const reader = { previous: () => undefined }
    const state = definition.start(context, start, reader)
    const active = { ...context, state }
    expect(definition.buildViewNode?.(active)).toBeNull()
    expect(definition.buildViewNode?.({ ...active, start: undefined })).toBeNull()
    expect(definition.buildViewNode?.(context)).toBeNull()
    const other: ConversationStartMatch = { ...start, event: at(2, 'turn/start', { turn: 1 }).event }
    expect(() => definition.start(context, other, reader)).toThrow('requires todo/write')
    expect(definition.update(active, { ...other, role: 'update' })).toBe(state)
    const update = { ...start, event: at(3, 'todo/write', { turn: 1, todos: [
      { id: 'a', content: 'A', status: 'completed' }, { id: 'b', content: 'B', status: 'pending', dependsOn: ['a'] },
    ] }).event }
    const current = definition.update(active, update)
    expect(definition.buildViewNode?.({ ...active, state: current })).toMatchObject({ kind: 'workflow-plan', target: 'chat', data: { id: 'turn:1' } })
    expect(resolveWorkflowTasks({ id: 'ready', seq: 3, source: 'plan', tasks: [
      { id: 'a', content: 'A', status: 'completed', dependsOn: [] }, { id: 'b', content: 'B', status: 'pending', dependsOn: ['a'] },
    ] }, {})[1]?.status).toBe('pending')
  })

  it('replays unscoped runs and interrupted members without inventing completion', () => {
    const unscoped = snapshot(assembler([
      at(1, 'tool-workflow/run-start', { runId: 'run', name: 'Unscoped' }),
      at(2, 'tool-workflow/agent-start', { runId: 'run', seq: 1, label: 'Active work', childId: 'child' }),
    ]))
    expect(unscoped.graphs[0]?.turn).toBeUndefined()
    expect(unscoped.graphs[0]?.tasks[0]?.status).toBe('running')
    const interrupted = snapshot(assembler([
      at(1, 'turn/start', { turn: 1 }), at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool-workflow/run-start', { runId: 'run', name: 'Interrupted' }),
      at(4, 'tool-workflow/agent-start', { runId: 'run', seq: 1, label: 'Work', childId: 'child' }),
      at(5, 'turn/end', { turn: 1, reason: { kind: 'interrupted' } }),
    ]))
    expect(interrupted.graphs[0]?.tasks[0]?.status).toBe('interrupted')
    expect(workflowCanvasRunDefinition.buildViewNode?.({ key: 'pending', kind: 'workflow-canvas-run', id: 'run', matches: [], start: undefined, state: undefined, current: new Map() })).toBeNull()
  })
})
