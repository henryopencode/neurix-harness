/** Full workflow View and the automatically displayed per-turn Chat canvas. */
import { useId, useState } from 'react'
import { Button, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, SegmentedControl, Select, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { WorkflowGraph, WorkflowTask, WorkflowSourceInjected } from './canvas-contract.ts'
import type { createWorkflowCanvasStore } from './canvas-store.ts'
import { resolveWorkflowTasks } from './canvas-snapshot.ts'
import WorkflowCanvas from './WorkflowCanvas.tsx'
import { phaseTitle, taskDot, taskTitle } from './task-presentation.ts'
import css from './WorkflowView.module.css'

/** Narrow navigation and history commands supplied by this plugin. */
export interface WorkflowViewInjected extends WorkflowSourceInjected {
  readonly openTask: (graphId: string, taskId: string) => void
  readonly loadOlder: () => Promise<void>
}

type CanvasStore = ReturnType<typeof createWorkflowCanvasStore>

/** Complete full-View props derived from its Slot registration. */
export type WorkflowViewProps = PropsRuntime<'conversation.view'> & PropsStore<CanvasStore>
  & PropsLocale<'workflowCanvas'> & InjectFace<WorkflowViewInjected>

/** Automatic Chat preview uses the same Session-bound data and navigation. */
export type WorkflowPlanPreviewProps = PropsRuntime<'conversation.chat.node', 'workflow-plan'>
  & PropsLocale<'workflowCanvas'> & InjectFace<Pick<WorkflowViewInjected, 'openTask' | 'hooks'>>

const SOURCE_PRIORITY = { plan: 2, run: 1, turn: 0 }

/**
 * Follow the latest turn and prefer its more detailed plan or execution unless history is selected.
 * @param graphs - loaded task plans and workflow runs.
 * @param selected - the user's explicit selection.
 * @returns explicit history, or the most detailed current-turn graph.
 */
export function selectedWorkflowGraph(graphs: readonly WorkflowGraph[], selected: string | null): WorkflowGraph | undefined {
  const explicit = selected === null ? undefined : graphs.find(graph => graph.id === selected)
  if (explicit !== undefined) return explicit
  const latestTurn = graphs.reduce((turn, graph) => Math.max(turn, graph.turn ?? 0), 0)
  let latest: WorkflowGraph | undefined
  for (const graph of graphs) {
    if ((graph.turn ?? 0) !== latestTurn) continue
    if (latest === undefined || graph.tasks.length > latest.tasks.length
      || (graph.tasks.length === latest.tasks.length
        && (SOURCE_PRIORITY[graph.source] > SOURCE_PRIORITY[latest.source]
          || (graph.source === latest.source && graph.seq > latest.seq)))) latest = graph
  }
  return latest
}

function graphTitle(graph: WorkflowGraph, t: TranslateNS<'workflowCanvas'>): string {
  return graph.name ?? (graph.turn === undefined ? t('graph.plan') : t('graph.turn', { turn: graph.turn }))
}

interface WorkflowSurfaceProps {
  readonly tasks: readonly WorkflowTask[]
  readonly collapsed: readonly string[]
  readonly mode: 'canvas' | 'list'
  readonly onMode: (mode: 'canvas' | 'list') => void
  readonly onTogglePhase: (phase: string) => void
  readonly onSelect: (id: string) => void
  readonly t: TranslateNS<'workflowCanvas'>
}

function WorkflowSurface({ tasks, collapsed, mode, onMode, onTogglePhase, onSelect, t }: WorkflowSurfaceProps) {
  const id = useId()
  const [selectedId, setSelectedId] = useState<string>()
  const phases = [...new Set(tasks.flatMap(task => task.phase === undefined ? [] : [task.phase]))]
  const current = tasks.filter(task => !task.removed)
  const select = (taskId: string): void => { setSelectedId(taskId); onSelect(taskId) }
  return <div className={css.surface}>
    <div className={css.toolbar}>
      <span className={css.progress} aria-live="polite">{t('graph.progress', {
        done: current.filter(task => task.status === 'completed').length, total: current.length,
      })}</span>
      <SegmentedControl id={id} label={t('canvas.mode')} value={mode} onChange={onMode}
        options={[{ value: 'canvas', label: t('canvas.canvas') }, { value: 'list', label: t('canvas.list') }]} />
    </div>
    {phases.length > 0 && <div className={css.phases} role="group" aria-label={t('canvas.phases')}>
      {phases.map(phase => <Button key={phase} size="sm" variant="ghost" aria-expanded={!collapsed.includes(phase)}
        onClick={() => { onTogglePhase(phase) }}>
        <span aria-hidden>{collapsed.includes(phase)
          ? <IconChevronRightOutlineRegular size={14} />
          : <IconChevronDownOutlineRegular size={14} />}</span>
        {t('canvas.phaseCount', { phase: phaseTitle(phase, t), count: tasks.filter(task => task.phase === phase).length })}
      </Button>)}
    </div>}
    <div className={css.panel} id={`${id}-canvas-panel`} role="tabpanel" aria-labelledby={`${id}-canvas`} hidden={mode !== 'canvas'}>
      {mode === 'canvas' && <WorkflowCanvas tasks={tasks} collapsed={collapsed} selectedId={selectedId}
        onSelect={select} onTogglePhase={onTogglePhase} t={t} />}
    </div>
    <div className={css.panel} id={`${id}-list-panel`} role="tabpanel" aria-labelledby={`${id}-list`} hidden={mode !== 'list'}>
      {mode === 'list' && <ol className={css.taskList}>
        {tasks.map(task => <li key={task.id}>
          <button type="button" className={css.taskRow} onClick={() => { select(task.id) }}
            aria-label={t('task.open', { name: taskTitle(task.content, t, task.titleKey), status: t(`status.${task.status}`) })}>
            <StateDot state={taskDot(task.status)} />
            <span className={css.taskText}><span>{taskTitle(task.content, t, task.titleKey)}</span>
              {task.expectedOutput !== undefined && <span className={css.secondary}>{task.expectedOutput}</span>}
              {task.blockedReason !== undefined && <span>{task.blockedReason}</span>}
            </span>
            <span className={css.status}>{t(`status.${task.status}`)}</span>
          </button>
        </li>)}
      </ol>}
    </div>
  </div>
}

/**
 * Render task history and the selected workflow using only the canvas target's snapshot.
 * @param props - framework data, Session-local preferences, copy, and navigation.
 * @returns the workflow View, retaining loaded graphs when more history cannot load.
 */
export function WorkflowView({ useWorkflow, useStore, actions, useSession, openTask, loadOlder, t }: WorkflowViewProps) {
  const snapshot = useWorkflow(value => value)
  const state = useStore(value => value)
  const hasMore = useSession(value => value.hasMore)
  const loadingOlder = useSession(value => value.loadingOlder)
  const [loadFailed, setLoadFailed] = useState(false)
  const graph = selectedWorkflowGraph(snapshot.graphs, state.graphId)
  const counterpart = graph?.turn === undefined ? undefined : snapshot.graphs.findLast(item => item.turn === graph.turn
    && item.id !== graph.id && item.source === (graph.source === 'run' ? 'plan' : 'run'))
  const tasks = graph === undefined ? [] : resolveWorkflowTasks(graph, snapshot.executions)
  const load = async (): Promise<void> => {
    setLoadFailed(false)
    try { await loadOlder() }
    catch (_error) { setLoadFailed(true) }
  }
  return <section className={css.view} aria-label={t('view.title')}>
    {graph === undefined ? <div className={css.empty}>
      <span>{t('view.empty')}</span><span className={css.secondary}>{t('view.emptyHint')}</span>
    </div> : <>
      <div className={css.header}>
        <Select aria-label={t('view.history')} value={graph.id} onValueChange={actions.selectGraph}
          options={[...snapshot.graphs].sort((a, b) => b.seq - a.seq).map(item => ({ value: item.id, label: graphTitle(item, t) }))} />
        {counterpart !== undefined && <Button variant="ghost" size="sm" onClick={() => { actions.selectGraph(counterpart.id) }}>
          {t(counterpart.source === 'plan' ? 'view.plan' : 'view.execution', { count: counterpart.tasks.length })}
        </Button>}
        {state.graphId !== null && <Button variant="ghost" size="sm" onClick={() => { actions.selectGraph(null) }}>
          {t('view.latest')}
        </Button>}
      </div>
      <WorkflowSurface key={graph.id} tasks={tasks} collapsed={state.collapsed[graph.id] ?? []}
        mode={state.mode} onMode={actions.setMode} onTogglePhase={(phase) => { actions.togglePhase(graph.id, phase) }}
        onSelect={(taskId) => { openTask(graph.id, taskId) }} t={t} />
    </>}
    {loadFailed && <span className={css.notice} role="alert">{t('view.loadFailed')}</span>}
    {hasMore && <Button variant="ghost" size="sm" disabled={loadingOlder} onClick={() => { void load() }}>{t('view.older')}</Button>}
  </section>
}

/**
 * Display one evolving plan automatically at its original Chat position.
 * @param props - current keyed plan, recorded execution outcomes, and inspector command.
 * @returns a compact canvas that updates without duplicating the task plan on each write.
 */
export function WorkflowPlanPreview({ node, useWorkflow, openTask, t }: WorkflowPlanPreviewProps) {
  const executions = useWorkflow(value => value.executions)
  const [mode, setMode] = useState<'canvas' | 'list'>('canvas')
  const [collapsed, setCollapsed] = useState<string[]>([])
  const graph = node.data
  return <section className={css.preview} aria-label={t('graph.plan')}>
    <WorkflowSurface tasks={resolveWorkflowTasks(graph, executions)} collapsed={collapsed} mode={mode} onMode={setMode}
      onTogglePhase={(phase) => {
        setCollapsed(current => current.includes(phase) ? current.filter(item => item !== phase) : [...current, phase])
      }}
      onSelect={(taskId) => { openTask(graph.id, taskId) }} t={t} />
  </section>
}
