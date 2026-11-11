/**
 * Conversation-local model controls and attributed group messages.
 * @module
 */
import { useState } from 'react'
import { IconStopFillRegular, MarkdownText, Select, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-experimental-agent-team/client'
import type {} from './post.ts'
import type { ModelGroupDelivery, ModelGroupMember } from '../types.ts'
import css from './Group.module.css'

/**
 * Session-scoped human operations supplied by the browser registration.
 */
export interface GroupActions {
  /**
   * @param line - Group command suffix.
   * @returns after Host acceptance or an actionable failure.
   */
  readonly command: (line: string) => Promise<void>
}

/** Mode selector's declared Session reads and human command action. */
export type GroupModeProps = Pick<PropsRuntime<'conversation.input.left'>, 'sessionId' | 'useSessions'>
  & InjectFace<GroupActions> & PropsLocale<'model-group'>

/** Roster controls consume shared Session hooks and only the editor insertion actions. */
export type GroupDockProps = Pick<PropsRuntime<'conversation.input.dock'>, 'sessionId' | 'useSession' | 'useSessions' | 'useSessionStatus'>
  & { readonly inputActions: Pick<PropsRuntime<'conversation.input.dock'>['inputActions'], 'insertText' | 'captureInsertion'> }
  & InjectFace<GroupActions> & PropsLocale<'model-group'>

/**
 * Conversation-local single/multi selection; does not edit plugin defaults.
 * @param props - Session and command actions.
 * @returns Mode control.
 */
export function GroupMode({ sessionId, useSessions, command, t }: GroupModeProps) {
  const group = useSessions(state => state.projectionsBySession[sessionId]?.values.modelGroup)
  const subagent = useSessions(state => state.byId[sessionId]?.origin === 'subagent')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (group === undefined || subagent) return null
  return <div className={css.mode}>
    <Select aria-label={t('mode')} value={group?.mode ?? 'single'} disabled={busy}
      options={[{ value: 'multi', label: t('multi') }, { value: 'single', label: t('single') }]}
      onValueChange={(mode) => {
        setBusy(true); setError(null)
        void command(mode).catch((failure: unknown) => { setError(failure instanceof Error ? failure.message : t('operationFailed')) }).finally(() => { setBusy(false) })
      }} />
    {error === null ? null : <span role="alert" className={css.error}>{error}</span>}
  </div>
}

/**
 * Single-line model controls above the resident editor.
 * @param props - Session, Team projection, and human controls.
 * @returns Group panel or nothing in single mode.
 */
export function GroupDock({ sessionId, useSession, useSessions, useSessionStatus, inputActions, command, t }: GroupDockProps) {
  const group = useSessions(state => state.projectionsBySession[sessionId]?.values.modelGroup)
  const team = useSessions(state => state.projectionsBySession[sessionId]?.values.legacyAgentTeam)
  const statuses = useSessionStatus(state => state)
  const leaderRunning = useSession(state => state.running)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (group?.mode !== 'multi') return null
  const run = (line: string): void => {
    setBusy(true); setError(null)
    void command(line).catch((failure: unknown) => { setError(failure instanceof Error ? failure.message : t('operationFailed')) }).finally(() => { setBusy(false) })
  }
  return <section className={css.group} aria-label={t('title')}>
    <div className={css.controls}>
      {group.members.length === 0 ? <p className={css.empty}>{t('noModels')}</p> : <div className={css.members}>
        {group.members.map((member) => {
          const row = team?.members.find(row => (row.name === member.name && row.coordinationOwner === 'model-group')
            || (member.name === group.leader && row.role === 'lead'))
          const running = member.name === group.leader ? leaderRunning : row !== undefined && statuses.get(row.id)?.running === true
          return <div key={member.name} className={css.member}>
            <button type="button" aria-label={`${t('mention')}: ${member.label}`} onClick={() => { inputActions.insertText(`@${member.name} `, inputActions.captureInsertion()) }}>
              <span className={css.name}>{member.label}</span>
              {member.name === group.leader ? <span className={css.badge}>{t('leader')}</span> : null}
              {running ? <span className={css.activity}>{t('running')}</span>
                : group.stoppedMembers.includes(member.name) ? <span className={css.secondary}>{t('stopped')}</span> : null}
            </button>
            {running && member.name !== group.leader ? <Tooltip portal label={`${t('stopMember')}: ${member.label}`} side="top" delayMs={500}>
              <button type="button" className={css.stopMember} aria-label={`${t('stopMember')}: ${member.label}`} disabled={busy} onClick={() => { run(`stop ${member.name}`) }}><IconStopFillRegular size={14} /></button>
            </Tooltip> : null}
          </div>
        })}
      </div>}
    </div>
    {team?.failure === undefined ? null : <p role="alert" className={css.error}>{team.failure}</p>}
    {error === null ? null : <p role="alert" className={css.error}>{error}</p>}
  </section>
}

/**
 * Render one publicly posted model response without losing its author.
 * @param props - Typed Chat node and localized Markdown controls.
 * @returns Attributed group message.
 */
export function GroupPost({ node, sessionId, useSessions, t }: Pick<PropsRuntime<'conversation.chat.node', 'model-group-post'>, 'node' | 'sessionId' | 'useSessions'> & PropsLocale<'model-group'>) {
  const members = useSessions(state => state.projectionsBySession[sessionId]?.values.modelGroup?.members)
  // Assignment posts from existing logs have no member-output sequence.
  if (node.data.member !== 'user' && node.data.sourceSeq === undefined && node.data.failure === undefined) {
    return <details className={css.assignment}><summary>{t('assignment')} · {node.data.label}</summary>
      <MarkdownText text={node.data.text} labels={{ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }} />
    </details>
  }
  const label = node.data.member === 'user' ? t('user') : node.data.label
  return <article className={css.post} data-group-member={node.data.member}>
    <div className={css.author}>{node.data.member === 'user' ? null : <span className={css.avatar} aria-hidden="true">{label.slice(0, 2)}</span>}<span>{label}</span></div>
    {node.data.failure === undefined ? null : <p role="alert" className={css.failure}>{t(node.data.failure === 'aborted' ? 'stopped' : 'failed')}</p>}
    {node.data.text === '' ? null : <MarkdownText text={node.data.text} labels={{ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }} />}
    {node.data.delivery === undefined ? null : <DeliveryNotice delivery={node.data.delivery} members={members} t={t} />}
  </article>
}

function DeliveryNotice({ delivery, members, t }: PropsLocale<'model-group'> & {
  delivery: ModelGroupDelivery
  members: readonly ModelGroupMember[] | undefined
}) {
  return <div className={css.delivery}>
    {delivery.accepted.length === 0 ? null : <p role="status">{t('sentTo')} {delivery.accepted.map(receipt => members?.find(member => member.name === receipt.member)?.label ?? receipt.member).join(', ')}</p>}
    {delivery.failed.length === 0 ? null : <p role="alert" className={css.failure}>{t('deliveryFailed')} {delivery.failed.map(name => members?.find(member => member.name === name)?.label ?? name).join(', ')}</p>}
  </div>
}

/**
 * Acknowledge direct delivery without claiming model execution finished.
 * @param props - Root Session, recorded receipt, and locale.
 * @returns Delivery status below the ordinary user message.
 */
export function GroupDelivery({ node, sessionId, useSessions, t }: Pick<PropsRuntime<'conversation.chat.node', 'model-group-delivery'>, 'node' | 'sessionId' | 'useSessions'> & PropsLocale<'model-group'>) {
  const members = useSessions(state => state.projectionsBySession[sessionId]?.values.modelGroup?.members)
  return <DeliveryNotice delivery={node.data} members={members} t={t} />
}

/**
 * Attribute the resident Assistant's replies while the conversation uses its group leader.
 * @param props - Captured group configuration and localized label.
 * @returns A model heading, or nothing outside group mode.
 */
export function GroupLeaderHeader({ sessionId, useSessions, t }: Pick<PropsRuntime<'conversation.chat.assistant.header'>, 'sessionId' | 'useSessions'> & PropsLocale<'model-group'>) {
  const group = useSessions(state => state.projectionsBySession[sessionId]?.values.modelGroup)
  const leader = group?.mode === 'multi' ? group.members.find(member => member.name === group.leader) : undefined
  if (leader === undefined) return null
  return <div className={css.leaderHeader} data-group-member={leader.name}>
    <span className={css.avatar} aria-hidden="true">{leader.label.slice(0, 2)}</span>
    <span className={css.name}>{leader.label}</span><span className={css.badge}>{t('leader')}</span>
  </div>
}
