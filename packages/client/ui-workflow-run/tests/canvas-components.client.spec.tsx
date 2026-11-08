// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate, sessionSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkflowGraph, WorkflowSnapshot } from '../src/client/canvas-contract.ts'
import { createWorkflowCanvasStore } from '../src/client/canvas-store.ts'
import { WorkflowPlanPreview, WorkflowView, selectedWorkflowGraph, type WorkflowPlanPreviewProps, type WorkflowViewProps } from '../src/client/WorkflowView.tsx'
import { WorkflowTaskDetails, WorkflowTaskTitle, type WorkflowTaskDetailsProps } from '../src/client/WorkflowTaskDetails.tsx'
import { en } from '../src/client/canvas-locales.ts'
import { taskDot } from '../src/client/task-presentation.ts'

const flow = vi.hoisted(() => ({ zoomIn: vi.fn(), zoomOut: vi.fn(), fitView: vi.fn() }))

// Browser acceptance owns React Flow's measurement and pan/zoom implementation.
// This double exposes our node renderers and commands without emulating browser geometry.
vi.mock('@xyflow/react', async () => {
  const { createElement, useEffect } = await import('react')
  return {
    Position: { Left: 'left', Right: 'right' }, MarkerType: { ArrowClosed: 'arrowclosed' }, Handle: () => null,
    ReactFlow: ({ nodes, nodeTypes, onInit }: {
      nodes: { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }[]
      nodeTypes: Record<string, (props: { data: Record<string, unknown> }) => React.ReactNode>
      onInit: (instance: typeof flow) => void
    }) => {
      useEffect(() => { onInit(flow) }, [onInit])
      return <div data-testid="flow">
        {nodes.map(node => <div key={node.id} data-node-id={node.id} data-position={JSON.stringify(node.position)}>
          {createElement(nodeTypes[node.type]!, { data: node.data })}
        </div>)}
      </div>
    },
  }
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

const SID = 'canvas-parent' as SessionId
const CHILD = 'canvas-child' as SessionId
const t = makeTranslate(en)
const graph: WorkflowGraph = {
  id: 'turn:1', seq: 3, turn: 1, source: 'plan', tasks: [
    { id: 'research', content: 'Research', phase: 'Prepare', status: 'completed', dependsOn: [], result: 'Sources verified.' },
    { id: 'build', content: 'Build', phase: 'Implement', status: 'running', dependsOn: ['research'],
      description: 'Read the existing implementation.', expectedOutput: 'A tested page.', artifacts: ['page.html', 'page.html'], sessionId: CHILD },
    { id: 'review', content: 'Review', phase: 'Implement', status: 'pending', dependsOn: ['build'], blockedReason: 'Choose a layout.' },
  ],
}

function setup(initial: WorkflowSnapshot = { graphs: [graph], executions: {} }) {
  const snapshots = createSnapshotStore(initial)
  const store = createWorkflowCanvasStore().create()
  const session = createSnapshotStore(sessionSnapshot(SID))
  const openTask = vi.fn()
  const props = {
    sessionId: SID, t, useWorkflow: bindSnapshotSelector(snapshots), useStore: bindSnapshotSelector(store), actions: store.actions,
    useSession: bindSnapshotSelector(session), openTask, loadOlder: vi.fn(async () => {}),
  } as WorkflowViewProps
  return { props, snapshots, store, session, openTask }
}

describe('workflow canvas presentation', () => {
  it('keeps task positions during progress updates and routes node and viewport actions', () => {
    const fixture = setup()
    const view = render(<WorkflowView {...fixture.props} />)
    const before = view.container.querySelector('[data-node-id="task:build"]')?.getAttribute('data-position')
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Build, Running' }))
    expect(fixture.openTask).toHaveBeenCalledWith(graph.id, 'build')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fit canvas' }))
    fireEvent.click(screen.getByRole('button', { name: 'Locate running tasks' }))
    expect(flow.zoomIn).toHaveBeenCalledOnce()
    expect(flow.zoomOut).toHaveBeenCalledOnce()
    expect(flow.fitView).toHaveBeenLastCalledWith(expect.objectContaining({ nodes: [expect.objectContaining({ id: 'task:build' })] }))
    act(() =>{  fixture.snapshots.set({ graphs: [{ ...graph, tasks: graph.tasks.map(task => ({ ...task, status: 'completed' })) }], executions: {} }) })
    expect(view.container.querySelector('[data-node-id="task:build"]')?.getAttribute('data-position')).toBe(before)
    expect(screen.getByRole('button', { name: 'Locate running tasks' }).hasAttribute('disabled')).toBe(true)
  })

  it('folds and reopens stages and retains display preferences after remount', () => {
    const fixture = setup()
    let view = render(<WorkflowView {...fixture.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Implement · 2' }))
    expect(view.container.querySelectorAll('[data-node-id]')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Expand Implement · 2, Running' }))
    expect(view.container.querySelectorAll('[data-node-id]')).toHaveLength(3)
    fireEvent.click(screen.getByRole('tab', { name: 'List' }))
    expect(screen.getByText('Choose a layout.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Review, Blocked' }))
    expect(fixture.openTask).toHaveBeenLastCalledWith(graph.id, 'review')
    view.unmount()
    view = render(<WorkflowView {...fixture.props} />)
    expect(screen.getByRole('tab', { name: 'List' }).getAttribute('aria-selected')).toBe('true')
    expect(view.container.querySelector('[data-testid="flow"]')).toBeNull()
  })

  it('keeps loaded plans visible when older history fails and allows retry', async () => {
    const fixture = setup()
    fixture.session.set({ ...fixture.session.getSnapshot(), hasMore: true })
    const props = { ...fixture.props, loadOlder: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined) }
    render(<WorkflowView {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Load earlier tasks' }))
    await screen.findByRole('alert')
    expect(screen.getByText('A tested page.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Load earlier tasks' }))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
  })

  it('shows an empty state and selects explicit history before preferring the latest plan', () => {
    const fixture = setup({ graphs: [], executions: {} })
    render(<WorkflowView {...fixture.props} />)
    expect(screen.getByText('No task plan yet')).toBeTruthy()
    const run: WorkflowGraph = { ...graph, id: 'run:1', seq: 10, source: 'run', name: 'Parallel audit' }
    expect(selectedWorkflowGraph([graph, run], null)).toBe(graph)
    expect(selectedWorkflowGraph([graph, run], run.id)).toBe(run)
    expect(selectedWorkflowGraph([run], null)).toBe(run)
    expect(selectedWorkflowGraph([], null)).toBeUndefined()
    const later = { ...graph, id: 'later', seq: 5 }
    expect(selectedWorkflowGraph([later, graph, run, { ...run, seq: 2 }], 'missing')).toBe(later)
  })

  it.each(['completed', 'failed', 'blocked', 'pending', 'running', 'cancelled', 'interrupted', 'waiting', 'removed'] as const)('shows %s for a folded stage', (status) => {
    const fixture = setup({ graphs: [{ ...graph, tasks: [
      { id: 'one', content: 'One', status, phase: 'Stage', dependsOn: [] },
      { id: 'two', content: 'Two', status, phase: 'Stage', dependsOn: [] },
    ] }], executions: {} })
    fixture.store.actions.togglePhase(graph.id, 'Stage')
    render(<WorkflowView {...fixture.props} />)
    expect(screen.getByRole('button', { name: `Expand Stage · 2, ${en[`status.${status}`]}` })).toBeTruthy()
  })

  it('opens earlier unphased plans while preserving the user’s explicit history selection', () => {
    const prior: WorkflowGraph = { id: 'prior', seq: 1, source: 'plan', tasks: [
      { id: 'prior-task', content: 'Prior task', status: 'completed', dependsOn: [] },
    ] }
    const later = { ...graph, id: 'later', seq: 5, turn: 2 }
    const fixture = setup({ graphs: [later, prior, { ...graph, id: 'run', source: 'run', name: 'Audit', seq: 9 }], executions: {} })
    render(<WorkflowView {...fixture.props} />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Select task plan' }))
    fireEvent.click(screen.getByRole('option', { name: 'Task plan' }))
    expect(fixture.store.getSnapshot().graphId).toBe('prior')
    expect(screen.getByRole('button', { name: 'Inspect Prior task, Completed' })).toBeTruthy()
    act(() =>{  fixture.snapshots.set({ ...fixture.snapshots.getSnapshot(), graphs: [prior, { ...later, seq: 20 }] }) })
    expect(screen.getByRole('button', { name: 'Inspect Prior task, Completed' })).toBeTruthy()
  })

  it('keeps historical empty labels accessible without changing the phase identity', () => {
    const fixture = setup({ graphs: [{ ...graph, source: 'run', tasks: [
      { id: 'empty-label', content: '', phase: '', status: 'running', dependsOn: [] },
    ] }], executions: {} })
    render(<WorkflowView {...fixture.props} />)
    expect(screen.getByRole('button', { name: 'Inspect Unnamed task, Running' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Unnamed phase · 1' }))
    expect(fixture.store.getSnapshot().collapsed[graph.id]).toEqual([''])
    expect(screen.getByRole('button', { name: 'Expand Unnamed phase · 1, Running' })).toBeTruthy()
  })

  it('keeps failures visible in folded stages and explains removed tasks on the graph', () => {
    const fixture = setup({ graphs: [{ ...graph, tasks: [
      { id: 'done', content: 'Finished', phase: 'Stage', status: 'completed', dependsOn: [] },
      { id: 'failed', content: 'Failed work', phase: 'Stage', status: 'failed', dependsOn: [] },
      { id: 'blocked', content: 'Dependent work', status: 'pending', dependsOn: ['failed'], expectedOutput: 'Expected deliverable' },
      { id: 'removed', content: 'Removed work', status: 'removed', removed: true, dependsOn: [] },
    ] }], executions: {} })
    render(<WorkflowView {...fixture.props} />)
    expect(screen.getByRole('button', { name: 'Inspect Dependent work, Blocked' }).textContent).toContain('Expected deliverable')
    expect(screen.getByRole('button', { name: 'Inspect Removed work, Removed from plan' }).textContent).toContain('Removed from plan')
    fireEvent.click(screen.getByRole('button', { name: 'Stage · 2' }))
    expect(screen.getByRole('button', { name: 'Expand Stage · 2, Failed' })).toBeTruthy()
  })

  it('updates the automatically displayed plan preview through its stable task identity', () => {
    const fixture = setup()
    const props = {
      ...fixture.props,
      node: { key: 'preview', kind: 'workflow-plan', id: graph.id, target: 'chat', anchorSeq: 3,
        location: { kind: 'unresolved' }, visibility: 'visible', data: graph },
      openFile: () => {}, forkAt: () => {}, loadImage: async () => '', fileMentions: () => undefined,
      inspectCall: () => {}, useTurnData: () => undefined, useDisclosure: () => { throw new Error('unused disclosure') },
      useGroupAction: () => ({ current: null }),
    } as WorkflowPlanPreviewProps
    render(<WorkflowPlanPreview {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Implement · 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Implement · 2' }))
    fireEvent.click(screen.getByRole('tab', { name: 'List' }))
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Build, Running' }))
    expect(fixture.openTask).toHaveBeenCalledWith(graph.id, 'build')
  })
})

describe('workflow task inspector', () => {
  it('shows complete task evidence, opens artifacts, and permits a verified settled child', () => {
    const fixture = setup({ graphs: [graph], executions: { [CHILD]: { status: 'completed', seq: 4 } } })
    const sessions: SessionListState = {
      ids: [CHILD], phase: 'ready',
      byId: { [CHILD]: { id: CHILD, parentId: SID, displayTitle: 'Child', running: false, retainedBy: {}, blank: false, updatedAt: 0 } },
      projectionsBySession: { [CHILD]: { state: 'ready', error: null, values: { subagent: { mode: 'continuable', label: 'Build', seq: 0 as never } } } },
    }
    const openArtifact = vi.fn()
    const openSession = vi.fn()
    let taskId = 'build'
    let noParams = false
    const signal = new AbortController().signal
    const props = {
      ...fixture.props, openArtifact, openSession, useSessions: bindSnapshotSelector(createSnapshotStore(sessions)),
      useTabInfo: (): ReturnType<WorkflowTaskDetailsProps['useTabInfo']> => ({
        sidebar: { expanded: true, fullscreen: false },
        panel: { id: 'pane' as ReturnType<WorkflowTaskDetailsProps['useTabInfo']>['panel']['id'] },
        tab: {
          id: 'details' as ReturnType<WorkflowTaskDetailsProps['useTabInfo']>['tab']['id'],
          kind: 'workflow-node', contentId: 'sidebar://workflow-node', title: 'Task details', visible: true, signal,
          navigation: { address: 'sidebar://workflow-node', params: noParams ? undefined : { workflowGraphId: graph.id, workflowTaskId: taskId }, revision: 0 },
          actions: { bindCommands: () => () => {}, openResource: () => {}, openTab: () => {}, close: () => {} },
        },
      }),
    } as WorkflowTaskDetailsProps
    const view = render(<WorkflowTaskDetails {...props} />)
    expect(screen.getByText('Execution recorded')).toBeTruthy()
    expect(screen.getByText('A tested page.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'page.html' }))
    expect(openArtifact).toHaveBeenCalledWith('page.html')
    fireEvent.click(screen.getByRole('button', { name: 'Open execution session' }))
    expect(openSession).toHaveBeenCalledWith({ parentSessionId: SID, childSessionId: CHILD, mode: 'continuable' })
    taskId = 'research'
    view.rerender(<WorkflowTaskDetails {...props} />)
    expect(screen.getByText('Sources verified.')).toBeTruthy()
    expect(screen.getByText('Planned status')).toBeTruthy()
    taskId = 'review'
    view.rerender(<WorkflowTaskDetails {...props} />)
    expect(screen.getByText('Choose a layout.')).toBeTruthy()
    act(() =>{  fixture.snapshots.set({ graphs: [{ ...graph, tasks: graph.tasks.map(task => task.id === 'review'
      ? { ...task, status: 'removed', removed: true, sessionId: CHILD, dependsOn: ['outside-loaded-plan'] } : task) }], executions: { [CHILD]: { status: 'running', seq: 4 } } }) })
    view.rerender(<WorkflowTaskDetails {...props} />)
    expect(screen.getByText('Removed from plan')).toBeTruthy()
    taskId = 'research'
    view.rerender(<WorkflowTaskTitle {...props} />)
    expect(screen.getByText('Research')).toBeTruthy()
    taskId = 'missing'
    view.rerender(<WorkflowTaskTitle {...props} />)
    expect(screen.getByText('Task details')).toBeTruthy()
    view.rerender(<WorkflowTaskDetails {...props} />)
    expect(screen.getByText('This task is outside the currently loaded plan')).toBeTruthy()
    noParams = true
    view.rerender(<WorkflowTaskTitle {...props} />)
    expect(screen.getByText('Task details')).toBeTruthy()
    view.rerender(<WorkflowTaskDetails {...props} />)
    expect(screen.getByText('This task is outside the currently loaded plan')).toBeTruthy()
  })

  it('uses explicit waiting and failure markers without treating a plan as execution', () => {
    expect(['pending', 'waiting', 'removed', 'blocked', 'running', 'completed', 'failed', 'cancelled', 'interrupted'].map(
      status => taskDot(status as Parameters<typeof taskDot>[0]),
    )).toEqual(['idle', 'idle', 'idle', 'warning', 'ongoing', 'done', 'error', 'warning', 'warning'])
  })
})
