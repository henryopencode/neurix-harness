/** Localized group coordination summaries with on-demand recorded details. @module */
import { DisclosureRow, IconChecklistOutlineRegular, IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type { GroupKey } from './locales.ts'
import css from './Group.module.css'

type GroupToolProps = Pick<PropsRuntime<'tool.call.toolview'>, 'phase' | 'block' | 'toolName' | 'useDisclosure' | 'sessionId' | 'useSessions'> & PropsLocale<'model-group'>

const TASK_LABELS: Readonly<Record<string, GroupKey>> = {
  list: 'taskList', create: 'taskCreate', claim: 'taskClaim', complete: 'taskComplete',
  release: 'taskRelease', set_dependencies: 'taskDependencies',
}

/**
 * Name the operation and target without treating task instructions as a model reply.
 * @param props - Tool lifecycle, recorded arguments, disclosure, and locale.
 * @returns An accessible operation row retaining raw input and result on expansion.
 */
export function GroupToolRow({ phase, block, toolName, useDisclosure, sessionId, useSessions, t }: GroupToolProps) {
  const { expanded, toggle } = useDisclosure()
  const group = useSessions(state => state.projectionsBySession[sessionId]?.values.modelGroup)
  const assignment = toolName === 'model_group_assign'
  const model = block.args.text('model')
  const target = group?.members.find(member => member.name === model)?.label ?? model
  const subject = assignment ? target : block.args.text('subject') || block.args.text('task')
  const action = block.args.text('action')
  const label = assignment ? t('assignment') : t(action === undefined ? 'taskUpdate' : TASK_LABELS[action] ?? 'taskUpdate')
  const title = subject === undefined || subject === '' ? label : `${label} · ${subject}`
  const settled = phase === 'result' && 'kind' in block ? block : undefined
  const failed = settled?.isError === true
  const error = failed ? assignment
    ? model === group?.leader ? t('selfAssignment') : t('dispatchFailed') : t('taskFailed') : undefined
  const input = phase === 'result' && 'kind' in block ? block.call?.argsRaw
    : 'argsRaw' in block ? block.argsRaw : undefined
  const output = settled?.content.filter(content => content.type === 'text').map(content => content.text).join('\n')
  return <div className={css.operation}>
    <DisclosureRow title={title} icon={assignment ? <IconUsersOutlineRegular size={14} /> : <IconChecklistOutlineRegular size={14} />}
      open={expanded && phase !== 'preparing'} expandable={phase !== 'preparing'} onToggle={toggle} expandOnRowClick
      running={phase !== 'result'} rowClassName={css.operationRow} titleClassName={css.operationTitle}
      headerAccessory={failed ? <span className={css.failure}>{t(assignment ? 'assignmentFailed' : 'actionFailed')}</span>
        : assignment && settled !== undefined ? <span className={css.secondary}>{t('assigned')}</span> : null}>
      <div className={css.operationDetails}>
        {input === undefined ? null : <><h4>{t('input')}</h4><pre className={css.raw}>{input}</pre></>}
        {output === undefined || output === '' ? null : <><h4>{t('output')}</h4><pre className={css.raw}>{output}</pre></>}
      </div>
    </DisclosureRow>
    {error === undefined ? null : <p role="alert" className={css.failure}>{error}</p>}
  </div>
}
