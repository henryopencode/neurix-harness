/** Expand a native delegation in place to inspect its task, activity and outcome. */
import { useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { DisclosureRow, IconAgentPresetOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './external-activity.ts'
import css from './ExternalActivityRow.module.css'

type ActivityProps = PropsRuntime<'conversation.chat.node', 'external-agent-activity'> & PropsLocale<'subagent'>

/**
 * Present one delegated native execution.
 * @param props - projected activity and its locale.
 * @returns the conversation disclosure.
 */
export function ExternalActivityRow({ node, t }: ActivityProps): ReactNode {
  const [open, setOpen] = useState(false)
  const { invocation, updates, terminal } = node.data
  const status = terminal?.status ?? 'started'
  return <DisclosureRow
    icon={<IconAgentPresetOutlineRegular size={14} />}
    title={t('native.title', { product: invocation.product, label: invocation.label })}
    rowClassName={css.row}
    contentLayoutClassName={css.summary}
    titleClassName={css.title}
    collapsedContent={<span className={css.status} role="status">{t(`native.${status}`)}</span>}
    keepContentWhenOpen
    open={open}
    expandable
    expandOnRowClick
    onToggle={() => { setOpen(value => !value) }}
  >
    <div className={css.body} data-native-subagent-activity>
      <div>
        <div className={css.label}>{t('native.task')}</div>
        <div className={css.text}>{invocation.prompt}</div>
        <code className={css.directory}>{invocation.cwd}</code>
      </div>
      {updates.map(({ seq, item }) => {
        if (item.kind === 'tool') return <div key={seq} className={css.label}>{t('native.tool', { name: item.name })}</div>
        if (item.kind === 'truncated') return <div key={seq} className={css.label}>{t('native.truncated')}</div>
        if (item.text === terminal?.text) return null
        return <div key={seq} className={css.text}>{item.text}</div>
      })}
      {terminal !== undefined && (terminal.text !== '' || terminal.diagnostic !== undefined) && <div>
        <div className={css.label}>{t('native.result')}</div>
        {terminal.text !== '' && <div className={css.text}>{terminal.text}</div>}
        {terminal.diagnostic !== undefined && <div className={css.text}>{terminal.diagnostic}</div>}
      </div>}
    </div>
  </DisclosureRow>
}
