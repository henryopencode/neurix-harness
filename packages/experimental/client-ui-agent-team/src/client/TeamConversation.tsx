/** Role-attributed Team replies and controls over the existing conversation. */
import { useState } from 'react'
import { IconStopFillRegular, MarkdownText, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { TeamPost as Post } from '@deepseek-ai/dsh-experimental-agent-team/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-experimental-model-group-runtime/types'
import css from './TeamModels.module.css'

/** Authenticated human Team command. */
export interface TeamCommands {
  /** @param line - Team command suffix. @returns After command acceptance, rejecting visibly on failure. */
  readonly command: (line: string) => Promise<void>
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap { 'team-post': Post }
}

/** Team outputs remain outside collapsed task-tool details, including historical group replies. */
export const teamPostDefinition: ConversationNodeDefinition<Post> = {
  kind: 'team-post', target: 'chat',
  match: event => event.type === 'team/post' || event.type === 'model-group/post' ? { id: String(event.seq), role: 'start' } : null,
  start: (_context, match) => {
    const event = match.event
    if (event.type === 'team/post') return event.data
    if (event.type !== 'model-group/post') throw new Error('Team reply expected')
    return { ...event.data, description: '', model: event.data.label }
  },
  update: context => context.state,
  buildViewNode: (context) => {
    const first = context.start ?? context.matches[0]
    if (first === undefined || context.state === undefined) return null
    const data = context.state
    if (data.member !== 'user' && data.sourceSeq === undefined && data.failure === undefined) return null
    return { key: context.key, kind: 'team-post', id: context.id, target: 'chat',
      anchorSeq: first.event.seq, location: first.location, visibility: 'visible',
      groupTree: data.member === 'user' ? 'input' : 'turn', data } satisfies ChatNode<'team-post'>
  },
}

/**
 * Public Team output identifies responsibility and model independently.
 * @param props - Typed post and localized Markdown controls.
 * @returns Attributed response.
 */
export function TeamPost({ node, t }: Pick<PropsRuntime<'conversation.chat.node', 'team-post'>, 'node'> & PropsLocale<'team-models'>) {
  return <article className={css.post} data-team-member={node.data.member}>
    <div className={css.author}><span>{node.data.member}</span><span className={css.secondary}>{node.data.label}</span></div>
    {node.data.failure === undefined ? null : <p role="alert" className={css.error}>{t('failed')}</p>}
    {node.data.text === '' ? null : <MarkdownText text={node.data.text} labels={{ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }} />}
  </article>
}

/**
 * One row of actual responsibilities with their independently selected models.
 * @param props - Session projections, editor actions and human commands.
 * @returns Team controls without a collaboration mode selector.
 */
export function TeamDock({ sessionId, useSession, useSessions, useSessionStatus, inputActions, command, t }:
  Pick<PropsRuntime<'conversation.input.dock'>, 'sessionId' | 'useSession' | 'useSessions' | 'useSessionStatus'>
  & { inputActions: Pick<PropsRuntime<'conversation.input.dock'>['inputActions'], 'insertText' | 'captureInsertion'> }
  & InjectFace<TeamCommands> & PropsLocale<'team-models'>) {
  const team = useSessions(state => state.projectionsBySession[sessionId]?.values.agentTeam)
  const selection = useSessions(state => state.projectionsBySession[sessionId]?.values.teamModels)
  const projections = useSessions(state => state.projectionsBySession)
  const subagent = useSession(state => state.subagent)
  const statuses = useSessionStatus(state => state)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (subagent !== null || team === undefined || ((selection?.models.length ?? 0) === 0 && team.members.length < 2)) return null
  return <section className={css.roster} aria-label={t('title')}>
    <div className={css.members}>{team.members.map((member) => {
      const model = projections[member.id]?.values.modelSelection?.next?.model
      const label = selection?.models.find(candidate => candidate.model === model)?.label ?? model
      const running = statuses.get(member.id)?.running === true
      return <div key={member.id} className={css.member}>
        <button type="button" aria-label={`${t('mention')}: ${member.name}`} onClick={() => { inputActions.insertText(`@${member.name} `, inputActions.captureInsertion()) }}>
          <span>{member.role === 'lead' ? t('leader') : member.name}</span>{label === undefined ? null : <span className={css.secondary}>{label}</span>}
          {running ? <span className={css.running}>{t('running')}</span> : null}
        </button>
        {running && member.role !== 'lead' ? <Tooltip portal label={`${t('stop')}: ${member.name}`} side="top"><button type="button" disabled={busy} aria-label={`${t('stop')}: ${member.name}`} onClick={() => {
          setBusy(true); setError(null)
          void command(`stop ${member.name}`).catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : t('operationFailed')) }).finally(() => { setBusy(false) })
        }}><IconStopFillRegular size={14} /></button></Tooltip> : null}
      </div>
    })}</div>
    {error === null ? null : <p role="alert" className={css.error}>{error}</p>}
  </section>
}

/** @param props - Captured candidates and current model. @returns Lead attribution in ordinary chat. */
export function TeamLeader({ sessionId, useSessions, t }: PropsRuntime<'conversation.chat.assistant.header'> & PropsLocale<'team-models'>) {
  const model = useSessions(state => state.projectionsBySession[sessionId]?.values.modelSelection?.next?.model)
  const selection = useSessions(state => state.projectionsBySession[sessionId]?.values.teamModels)
  if (selection === null || selection === undefined) return null
  const label = selection.models.find(candidate => candidate.model === model)?.label ?? model
  return <div className={css.author}><span>{t('leader')}</span>{label === undefined ? null : <span className={css.secondary}>{label}</span>}</div>
}
