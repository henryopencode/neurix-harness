/** Task inspector registered in the application's existing right sidebar. */
import { Button, IconChecklistOutlineRegular, PathLabel, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionTarget } from '@deepseek-ai/dsh-api-session-controller/client'
import { resolveWorkflowTasks, workflowExecutionStatus } from './canvas-snapshot.ts'
import { phaseTitle, taskDot, taskTitle } from './task-presentation.ts'
import type { WorkflowSourceInjected } from './canvas-contract.ts'
import css from './WorkflowView.module.css'

/** Only resource navigation crosses from the inspector to its registration. */
export interface WorkflowDetailsInjected extends WorkflowSourceInjected {
  readonly openArtifact: (path: string) => void
  readonly openSession: (target: SessionTarget) => void
}

/** Inspector props include the selected sidebar tab and this Session's workflow target. */
export type WorkflowTaskDetailsProps = PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'workflowCanvas'> & InjectFace<WorkflowDetailsInjected>

/**
 * Display complete task text, prerequisites, evidence, and deliverable links.
 * @param props - Session hooks, restored tab navigation, localized text, and navigation commands.
 * @returns current task details, or a localized unavailable state for a missing history page.
 */
export function WorkflowTaskDetails({
  useTabInfo, useWorkflow, useSessions, sessionId, openArtifact, openSession, t,
}: WorkflowTaskDetailsProps) {
  const { tab } = useTabInfo()
  const params = tab.navigation.params
  const snapshot = useWorkflow(value => value)
  const graphId = params !== undefined && 'workflowGraphId' in params ? params.workflowGraphId : undefined
  const taskId = params !== undefined && 'workflowTaskId' in params ? params.workflowTaskId : undefined
  const graph = snapshot.graphs.find(item => item.id === graphId)
  const tasks = graph === undefined ? [] : resolveWorkflowTasks(graph, snapshot.executions)
  const task = tasks.find(item => item.id === taskId)
  const child = useSessions(value => task?.sessionId === undefined ? undefined : value.byId[task.sessionId])
  const identity = useSessions(value => task?.sessionId === undefined
    ? undefined : value.projectionsBySession[task.sessionId]?.values.subagent)
  if (graph === undefined || task === undefined) return <div className={css.empty}>{t('task.missing')}</div>
  const prerequisites = task.dependsOn.flatMap((id) => {
    const found = tasks.find(item => item.id === id)
    return found === undefined ? [] : [found]
  })
  const artifacts = [...new Set(task.artifacts ?? [])]
  return <article className={css.details} aria-label={t('task.details')}>
    <h2 className={css.detailsTitle}>{taskTitle(task.content, t)}</h2>
    <div className={css.detailStatus}><StateDot state={taskDot(task.status)} />{t(`status.${task.status}`)}
      {task.removed && task.status !== 'removed' && <span>{t('task.removed')}</span>}
    </div>
    <span className={css.secondary}>{graph.source === 'run' || workflowExecutionStatus(snapshot.executions, task.sessionId, graph.seq) !== undefined ? t('task.recorded') : t('task.planned')}</span>
    {task.phase !== undefined && <span className={css.secondary}>{phaseTitle(task.phase, t)}</span>}
    {task.description !== undefined && <section className={css.detailSection}><h3>{t('task.description')}</h3><p>{task.description}</p></section>}
    {task.expectedOutput !== undefined && <section className={css.detailSection}><h3>{t('task.expectedOutput')}</h3><p>{task.expectedOutput}</p></section>}
    {prerequisites.length > 0 && <section className={css.detailSection}><h3>{t('task.dependencies')}</h3><ul>
      {prerequisites.map(item => <li key={item.id}><StateDot state={taskDot(item.status)} />{taskTitle(item.content, t)} · {t(`status.${item.status}`)}</li>)}
    </ul></section>}
    {task.blockedReason !== undefined && <section className={css.detailSection}><h3>{t('task.blocked')}</h3><p>{task.blockedReason}</p></section>}
    {task.result !== undefined && <section className={css.detailSection}><h3>{t('task.result')}</h3><p>{task.result}</p></section>}
    {artifacts.length > 0 && <section className={css.detailSection}><h3>{t('task.artifacts')}</h3>
      {artifacts.map(path => <Button key={path} variant="ghost" className={css.artifact} onClick={() => { openArtifact(path) }}><PathLabel path={path} /></Button>)}
    </section>}
    {task.sessionId !== undefined && child?.parentId === sessionId && identity !== undefined && identity !== null
      && <Button variant="outline" onClick={() => {
        openSession({ parentSessionId: sessionId, childSessionId: child.id, mode: identity.mode })
      }}>{t('task.session')}</Button>}
  </article>
}

type WorkflowTaskTitleProps = PropsRuntime<'sidebar.right.pane.tab.title'>
  & PropsLocale<'workflowCanvas'> & InjectFace<WorkflowSourceInjected>

/**
 * Give the inspector tab its task name and the shared task icon.
 * @param props - tab navigation, Session-bound plans, and fallback copy.
 * @returns the live tab title.
 */
export function WorkflowTaskTitle({ useTabInfo, useWorkflow, t }: WorkflowTaskTitleProps) {
  const { tab } = useTabInfo()
  const snapshot = useWorkflow(value => value)
  const params = tab.navigation.params
  const graphId = params !== undefined && 'workflowGraphId' in params ? params.workflowGraphId : undefined
  const taskId = params !== undefined && 'workflowTaskId' in params ? params.workflowTaskId : undefined
  const task = snapshot.graphs.find(graph => graph.id === graphId)?.tasks.find(item => item.id === taskId)
  return <span className={css.tabTitle}><IconChecklistOutlineRegular size={14} /><span>{task === undefined ? t('task.details') : taskTitle(task.content, t)}</span></span>
}
