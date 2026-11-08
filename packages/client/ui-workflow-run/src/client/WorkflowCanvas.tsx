/** Pannable task graph with stable layout and native keyboard-accessible nodes. */
import { useMemo, useRef } from 'react'
import { Handle, MarkerType, Position, ReactFlow, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react'
import { Button, IconChevronRightOutlineRegular, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { WorkflowTask, WorkflowTaskStatus } from './canvas-contract.ts'
import { layoutWorkflow, TASK_HEIGHT, TASK_WIDTH, type LayoutTask } from './canvas-layout.ts'
import { phaseTitle, taskDot, taskTitle } from './task-presentation.ts'
import '@xyflow/react/dist/style.css'
import css from './WorkflowCanvas.module.css'

/** Data and callbacks owned by the task graph's containing View. */
export interface WorkflowCanvasProps {
  readonly tasks: readonly WorkflowTask[]
  readonly collapsed: readonly string[]
  readonly selectedId: string | undefined
  readonly onSelect: (id: string) => void
  readonly onTogglePhase: (phase: string) => void
  readonly t: TranslateNS<'workflowCanvas'>
}

interface TaskNodeData extends Record<string, unknown> {
  readonly kind: 'task' | 'phase'
  readonly title: string
  readonly phase?: string
  readonly summary?: string
  readonly status: WorkflowTaskStatus
  readonly statusLabel: string
  readonly label: string
  readonly onSelect: () => void
}

type TaskNode = Node<TaskNodeData, 'task'>

function TaskNodeView({ data }: NodeProps<TaskNode>) {
  return <>
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <button type="button" className={css.node} data-status={data.status} onClick={data.onSelect} aria-label={data.label}
      aria-expanded={data.kind === 'phase' ? false : undefined}>
      <span className={css.nodeMeta}>
        {data.phase !== undefined && <span className={css.phase}>{data.phase}</span>}
        <span className={css.status}><StateDot state={taskDot(data.status)} />{data.statusLabel}</span>
        {data.kind === 'phase' && <IconChevronRightOutlineRegular size={14} />}
      </span>
      <span className={css.nodeTitle}>{data.title}</span>
      {data.summary !== undefined && <span className={css.nodeSummary}>{data.summary}</span>}
    </button>
    <Handle type="source" position={Position.Right} isConnectable={false} />
  </>
}

const NODE_TYPES = { task: TaskNodeView }
const PRO_OPTIONS = { hideAttribution: true }
const EDGE_OPTIONS = { markerEnd: { type: MarkerType.ArrowClosed }, type: 'smoothstep' }
const PHASE_STATUS_PRIORITY = {
  running: 0, failed: 1, blocked: 2, interrupted: 3, cancelled: 4,
  waiting: 5, pending: 6, completed: 7, removed: 8,
} as const satisfies Record<WorkflowTaskStatus, number>

function phaseStatus(tasks: readonly WorkflowTask[], initial: WorkflowTaskStatus): WorkflowTaskStatus {
  return tasks.reduce((status, task) => PHASE_STATUS_PRIORITY[task.status] < PHASE_STATUS_PRIORITY[status]
    ? task.status : status, initial)
}

/**
 * Render explicit task dependencies and preserve the viewport during progress updates.
 * @param props - current tasks, disclosure state, localized copy, and user actions.
 * @returns an interactive graph and its compact zoom controls.
 */
export default function WorkflowCanvas({ tasks, collapsed, selectedId, onSelect, onTogglePhase, t }: WorkflowCanvasProps) {
  const instance = useRef<ReactFlowInstance<TaskNode> | null>(null)
  const structure = JSON.stringify({ tasks: tasks.map(({ id, phase, dependsOn }) => ({ id, phase, dependsOn })), collapsed })
  const geometry = useMemo(() => {
    const input = JSON.parse(structure) as { tasks: LayoutTask[]; collapsed: string[] }
    return layoutWorkflow(input.tasks, input.collapsed)
  }, [structure])
  const byId = new Map(tasks.map(task => [task.id, task]))
  const nodes: TaskNode[] = geometry.nodes.map((node) => {
    // Layout nodes retain non-empty task-id lists from this same task collection.
    const members = node.taskIds.map(id => byId.get(id) as WorkflowTask)
    const task = members[0] as WorkflowTask
    const phase = node.phase
    const status = phase === undefined ? task.status : phaseStatus(members, task.status)
    const title = phase === undefined ? taskTitle(task.content, t) : t('canvas.phaseCount', { phase: phaseTitle(phase, t), count: members.length })
    const summary = phase === undefined
      ? task.removed ? t('task.removed') : task.status === 'blocked' ? task.blockedReason ?? task.expectedOutput : task.expectedOutput
      : undefined
    return {
      id: node.id, type: 'task', position: node.position,
      style: { width: TASK_WIDTH, height: TASK_HEIGHT },
      selected: selectedId !== undefined && node.taskIds.includes(selectedId),
      data: {
        kind: phase === undefined ? 'task' : 'phase', title, status, statusLabel: t(`status.${status}`),
        label: phase === undefined ? t('task.open', { name: title, status: t(`status.${status}`) })
          : t('canvas.expandPhase', { phase: title, status: t(`status.${status}`) }),
        ...phase === undefined && task.phase !== undefined ? { phase: phaseTitle(task.phase, t) } : {},
        ...summary === undefined ? {} : { summary },
        onSelect: phase === undefined ? () => { onSelect(task.id) } : () => { onTogglePhase(phase) },
      },
    }
  })
  const running = nodes.filter(node => node.data.status === 'running')
  return <div className={css.canvas} data-workflow-canvas>
    <div className={css.flow}>
      <ReactFlow<TaskNode>
        nodes={nodes} edges={geometry.edges} nodeTypes={NODE_TYPES} defaultEdgeOptions={EDGE_OPTIONS}
        onInit={(flow) => { instance.current = flow }} fitView fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
        nodesDraggable={false} nodesConnectable={false} nodesFocusable={false} edgesFocusable={false}
        minZoom={0.2} maxZoom={2} proOptions={PRO_OPTIONS} aria-label={t('canvas.label')}
        ariaLabelConfig={{ 'node.a11yDescription.default': '', 'node.a11yDescription.keyboardDisabled': '', 'edge.a11yDescription.default': '' }}
      />
    </div>
    <div className={css.zoom}>
      <Button variant="toolbar" size="sm" onClick={() => { void instance.current?.zoomOut() }}>{t('canvas.zoomOut')}</Button>
      <Button variant="toolbar" size="sm" onClick={() => { void instance.current?.zoomIn() }}>{t('canvas.zoomIn')}</Button>
      <Button variant="toolbar" size="sm" onClick={() => { void instance.current?.fitView({ maxZoom: 1, padding: 0.2 }) }}>{t('canvas.fit')}</Button>
      <Button variant="toolbar" size="sm" disabled={running.length === 0}
        onClick={() => { void instance.current?.fitView({ nodes: running, maxZoom: 1 }) }}>{t('canvas.current')}</Button>
    </div>
  </div>
}
