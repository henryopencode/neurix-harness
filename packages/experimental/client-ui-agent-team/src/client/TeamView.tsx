/** Chat-room presentation over independently attributed Team transcript messages. */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MessageImageLoader } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, FileTypeIcon, IconChevronDownOutlineRegular, IconCodeOutlineRegular, IconUserOutlineRegular, IconUsersOutlineRegular,
  JsonBlock, MarkdownText, StateDot, TextShimmer, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamFeedSnapshot } from './team-feed.ts'
import type { TeamMessage } from './team-messages.ts'
import { NS } from './locales.ts'
import css from './TeamView.module.css'

/** Transcript data and existing Session-authorized image loading. */
export interface TeamViewInjected {
  readonly hooks: { readonly teamFeed: import('@deepseek-ai/dsh-client-store').ObservableSnapshot<TeamFeedSnapshot> }
  readonly loadOlder: () => Promise<void>
  readonly loadImage: (sessionId: SessionId, attachment: ImageAttachmentRef) => Promise<string>
  readonly peekImage: (sessionId: SessionId, attachment: ImageAttachmentRef) => string | undefined
}

/** Framework-composed Team View props; the surrounding shell owns the composer. */
export type TeamViewProps = PropsRuntime<'conversation.view'> & InjectFace<TeamViewInjected>
  & PropsLocale<typeof NS> & PropsRenderFactories

type RowProps = Pick<TeamViewProps, 't' | 'renderFactorySlot' | 'loadImage' | 'peekImage'> & {
  readonly message: TeamMessage
  readonly members: TeamFeedSnapshot['members']
  readonly labels: MarkdownLabels
}

function MessageContent({ content, loader, renderFactorySlot, t }: {
  readonly content: readonly ContentBlock[]
  readonly loader: MessageImageLoader
} & Pick<RowProps, 'renderFactorySlot' | 't'>) {
  return content.map((block, index) => {
    switch (block.type) {
      case 'text': return <span key={index} className={css.inputText}>{block.text}</span>
      case 'image': return <span key={index}>{renderFactorySlot('conversation.images.content', {
        images: [{ attachment: block.attachment }], loadImage: loader, align: 'start', compact: true,
      })}</span>
      case 'file': return <span key={index} className={css.file}><FileTypeIcon path={block.attachment.name} />{block.attachment.name}</span>
      default: return <JsonBlock key={index} label={t('view.content')} payload={block}
        truncatedLabel={total => t('view.truncated', { total })} />
    }
  })
}

function ToolMessage({ message, loader, labels, renderFactorySlot, t }: {
  readonly message: Extract<TeamMessage, { kind: 'tool' }>
  readonly loader: MessageImageLoader
} & Pick<RowProps, 'labels' | 'renderFactorySlot' | 't'>) {
  const { block } = message
  const settled = 'kind' in block
  const failed = settled && block.isError
  const status = settled ? failed ? 'view.toolFailed' : 'view.toolDone'
    : block.phase === 'preparing' ? 'view.toolPreparing' : 'view.toolRunning'
  const args = settled ? block.call?.argsRaw : block.phase === 'start' ? block.argsRaw : undefined
  const text = settled ? block.content.filter(block => block.type === 'text').map(block => block.text).join('\n') : ''
  return (
    <details className={css.tool} data-tool-call={block.callId}>
      <summary>
        <IconCodeOutlineRegular size={16} />
        <span className={css.toolName}>{block.name || block.callId}</span>
        <span className={failed ? css.error : css.activity}>
          <StateDot state={settled ? failed ? 'error' : 'done' : 'ongoing'} />{t(status)}
        </span>
        <IconChevronDownOutlineRegular size={12} className={css.disclosure} />
      </summary>
      <div className={css.toolDetails}>
        {args !== undefined && args !== '' && <pre className={css.arguments}>{args}</pre>}
        {text !== '' && <MarkdownText text={text} labels={labels} />}
        {settled && <MessageContent content={block.content.filter(block => block.type !== 'text')}
          loader={loader} renderFactorySlot={renderFactorySlot} t={t} />}
        {failed && text === '' && <span className={css.error}>{block.error?.reason ?? block.error?.code ?? t('view.toolFailed')}</span>}
      </div>
    </details>
  )
}

const MessageRow = memo(function MessageRow({ message, members, labels, loadImage, peekImage, renderFactorySlot, t }: RowProps) {
  const sender = members.find(member => member.id === message.senderId)
  const name = message.user ? t('view.you') : sender?.name || t('view.lead')
  const recipient = message.senderId === message.sessionId ? undefined : members.find(member => member.id === message.sessionId)
  const loader: MessageImageLoader = useMemo(() => Object.assign(
    (attachment: ImageAttachmentRef) => loadImage(message.sessionId, attachment),
    { peek: (attachment: ImageAttachmentRef) => peekImage(message.sessionId, attachment) },
  ), [message.sessionId, loadImage, peekImage])
  const date = new Date(message.time)
  return (
    <article className={css.message} data-team-message={message.id} data-kind={message.kind} data-user={message.user || undefined}>
      <span className={css.avatar} data-lead={sender?.role === 'lead' || undefined} aria-hidden="true">
        {message.user ? <IconUserOutlineRegular size={16} />
          : sender?.role === 'lead' ? <IconUsersOutlineRegular size={16} /> : name.slice(0, 1).toUpperCase()}
      </span>
      <div className={css.messageBody}>
        <div className={css.messageHeader}>
          <span className={css.sender}>{name}</span>
          {recipient !== undefined && <span className={css.recipient}>→ {recipient.name || t('view.lead')}</span>}
          <time dateTime={date.toISOString()}>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
        </div>
        <div className={css.bubble}>
          {message.kind === 'thinking' && <span className={css.activity} role="status">
            <StateDot state="ongoing" /><TextShimmer active>{t('view.thinking')}</TextShimmer>
          </span>}
          {message.kind === 'reply' && <>
            {message.blocks.map((block, index) => {
              switch (block.kind) {
                case 'text': return <MarkdownText key={index} text={block.text} streaming={message.streaming} labels={labels} />
                case 'image': return <span key={index}>{renderFactorySlot('conversation.images.content', {
                  images: [{ attachment: block.attachment }], loadImage: loader, align: 'start',
                })}</span>
                case 'other': return <JsonBlock key={index} label={t('view.content')} payload={block.block}
                  truncatedLabel={total => t('view.truncated', { total })} />
                default: return null
              }
            })}
            {message.interrupted && <span className={css.activity}>{t('view.stopped')}</span>}
          </>}
          {message.kind === 'input' && <>
            {message.previews !== undefined && message.previews.length > 0 && renderFactorySlot('conversation.images.content', {
              images: message.previews, loadImage: loader, align: 'start', compact: true,
            })}
            <MessageContent content={message.content} loader={loader} renderFactorySlot={renderFactorySlot} t={t} />
            {message.pending && <span className={css.activity}>{t('view.sending')}</span>}
          </>}
          {message.kind === 'tool' && <ToolMessage message={message} loader={loader} labels={labels} renderFactorySlot={renderFactorySlot} t={t} />}
          {message.kind === 'error' && <span className={css.error} role="alert">{message.text || t('view.failed')}</span>}
        </div>
      </div>
    </article>
  )
})

/**
 * Render chronological member messages while leaving input and queue behavior with the Conversation shell.
 * @param props - framework-bound data, image callbacks, Factory renderer, and locale.
 * @returns the Team transcript with per-member loading failures and older-history access.
 */
export function TeamView({ useTeamFeed, loadOlder, loadImage, peekImage, renderFactorySlot, t }: TeamViewProps) {
  const feed = useTeamFeed(value => value)
  const scroll = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const olderPosition = useRef<{ height: number; top: number } | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const labels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('view.copy'), copiedLabel: t('view.copied') }, footnotes: t('view.footnotes'),
  }), [t])
  useEffect(() => {
    const content = scroll.current
    if (content === null) return
    const viewport = content.closest<HTMLElement>('[data-conversation-scroll]') ?? content
    const follow = (): void => {
      if (following.current && olderPosition.current === null) viewport.scrollTop = viewport.scrollHeight
    }
    const onScroll = (): void => {
      following.current = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 32
    }
    viewport.addEventListener('scroll', onScroll, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(follow)
    observer?.observe(content)
    observer?.observe(viewport)
    const composer = viewport.querySelector('[data-composer-seat]')
    if (composer !== null) observer?.observe(composer)
    follow()
    return () => {
      viewport.removeEventListener('scroll', onScroll)
      observer?.disconnect()
    }
  }, [])
  useEffect(() => {
    const content = scroll.current
    if (content === null) return
    const element = content.closest<HTMLElement>('[data-conversation-scroll]') ?? content
    if (olderPosition.current !== null && !feed.loadingOlder) {
      element.scrollTop = olderPosition.current.top + element.scrollHeight - olderPosition.current.height
      olderPosition.current = null
    } else if (following.current) element.scrollTop = element.scrollHeight
  }, [feed.messages, feed.loadingOlder])

  return (
    <div ref={scroll} className={css.view} data-team-view>
      <div className={css.column} role="log" aria-label={t('view.title')} aria-live="off">
        {feed.hasMore && <Button variant="ghost" className={css.older} disabled={feed.loadingOlder} onClick={() => {
          const element = scroll.current?.closest<HTMLElement>('[data-conversation-scroll]') ?? scroll.current
          if (element !== null) olderPosition.current = { height: element.scrollHeight, top: element.scrollTop }
          following.current = false
          setHistoryError(null)
          void loadOlder().catch((error: unknown) => {
            olderPosition.current = null
            setHistoryError(error instanceof Error ? error.message : String(error))
          })
        }}>{t(feed.loadingOlder ? 'view.loadingOlder' : 'view.loadOlder')}</Button>}
        {historyError !== null && <p className={css.error} role="alert">{t('view.unavailable', { name: t('view.title'), message: historyError })}</p>}
        {feed.failures.map(failure => <p key={failure.id} className={css.error} role="alert">
          {t('view.unavailable', { name: failure.name || t('view.lead'), message: failure.message })}
        </p>)}
        {feed.messages.map(message => <MessageRow key={message.id} message={message} members={feed.members}
          labels={labels} loadImage={loadImage} peekImage={peekImage} renderFactorySlot={renderFactorySlot} t={t} />)}
        {feed.loading && <span className={css.loading} role="status"><StateDot state="ongoing" />{t('view.loading')}</span>}
        {!feed.loading && feed.messages.length === 0 && feed.failures.length === 0 && <div className={css.empty}>
          <IconUsersOutlineRegular size={28} /><span>{t('view.empty')}</span>
        </div>}
      </div>
    </div>
  )
}
