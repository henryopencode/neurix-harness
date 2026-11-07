/** Role-attributed Team replies in the existing conversation. */
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { TeamPost as Post } from '@deepseek-ai/dsh-experimental-agent-team/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-experimental-model-group-runtime/types'
import css from './TeamModels.module.css'

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

/** @param props - Captured candidates and current model. @returns Lead attribution in ordinary chat. */
export function TeamLeader({ sessionId, useSessions, t }: PropsRuntime<'conversation.chat.assistant.header'> & PropsLocale<'team-models'>) {
  const model = useSessions(state => state.projectionsBySession[sessionId]?.values.modelSelection?.next?.model)
  const selection = useSessions(state => state.projectionsBySession[sessionId]?.values.teamModels)
  if (selection === null || selection === undefined) return null
  const label = selection.models.find(candidate => candidate.model === model)?.label ?? model
  return <div className={css.author}><span>{t('leader')}</span>{label === undefined ? null : <span className={css.secondary}>{label}</span>}</div>
}
