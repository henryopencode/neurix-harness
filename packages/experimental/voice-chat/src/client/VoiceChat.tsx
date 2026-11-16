/** Compact composer controls keep tool approvals and the written conversation accessible. */
import { useEffect } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { VoiceOptions, VoiceStatus } from '../types.ts'
import type { ConversationVoiceState } from './controller.ts'
import type { VoiceReply } from './replies.ts'
import { Button, IconCloseOutlineRegular, IconMicrophoneOutlineRegular, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { NS } from './locales.ts'
import css from './VoiceChat.module.css'

/** Preparation mirrors and interaction callbacks created by this plugin's registration. */
export interface VoiceChatInjected {
  hooks: {
    voiceState: HostObservable<ConversationVoiceState>
    voiceSetup: HostObservable<VoiceSetup>
    voicePanel: HostObservable<SessionId | null>
  }
  open: (sessionId: SessionId) => void
  close: () => void
  prepare: () => void
  cancelPreparation: () => void
  start: (sessionId: SessionId, replies: readonly VoiceReply[], turn: number) => void
  stop: (sessionId: SessionId) => void
  observe: (sessionId: SessionId, replies: readonly VoiceReply[], turn: number) => void
}

/** Complete local observations; connection failures never masquerade as ready. */
export interface VoiceSetup {
  readonly voice: VoiceStatus | null
  readonly options: VoiceOptions | null
  readonly recognitionReady: boolean
  readonly recognitionPreparing: boolean
  readonly connected: boolean
}

type TriggerProps = PropsRuntime<'conversation.input.right'> & PropsLocale<typeof NS> & InjectFace<VoiceChatInjected>
type PanelProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<typeof NS> & InjectFace<VoiceChatInjected>

/** Open the voice panel without acquiring the microphone or downloading models. */
export function VoiceChatTrigger({ sessionId, open, t }: TriggerProps) {
  return <Button size="sm" onClick={() => { open(sessionId) }} aria-label={t('open')}><IconMicrophoneOutlineRegular size={16} />{t('open')}</Button>
}

/** Render preparation and the active voice controls above the existing composer. */
export function VoiceChatPanel({ sessionId, useVoicePanel, useVoiceState, useVoiceSetup, useChat,
  inputActions, close, prepare, cancelPreparation, start, stop, observe, t }: PanelProps) {
  const opened = useVoicePanel(value => value === sessionId)
  const state = useVoiceState(value => value), setup = useVoiceSetup(value => value)
  const chat = useChat(value => value)
  const active = state.sessionId === sessionId && state.phase !== 'idle'
  useEffect(() => () => { stop(sessionId) }, [sessionId, stop])
  useEffect(() => {
    if (!active) return
    const replies: VoiceReply[] = chat.legacy.nodes.flatMap(node => node.kind === 'assistant' && !node.interrupted
      ? [{ key: `${node.turn}/${node.step}`, turn: node.turn,
        text: node.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join(''), final: true }] : [])
    const partial = chat.legacy.partial
    if (partial) replies.push({ key: `${partial.turn}/${partial.step}`, turn: partial.turn,
      text: partial.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join(''), final: false })
    observe(sessionId, replies, Math.max(0, ...chat.timeline.turnOrder))
  }, [chat, active, sessionId, observe])
  if (!opened) return null
  const status = setup.voice
  const usable = setup.connected && setup.recognitionReady && status?.phase === 'ready'
  const preparing = setup.recognitionPreparing || status?.phase === 'preparing'
  const initialReplies: VoiceReply[] = chat.legacy.nodes.flatMap(node => node.kind === 'assistant'
    ? [{ key: `${node.turn}/${node.step}`, turn: node.turn,
      text: node.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join(''), final: true }] : [])
  const progress = !setup.connected ? t('connecting') : status?.phase === 'unsupported' ? t('unsupported')
    : status?.operation === 'runtime' ? t('runtime') : status?.operation === 'loading' ? t('loading')
      : status?.operation === 'model' ? t('downloading', { completed: (status.completedBytes / 1e9).toFixed(2), total: (status.downloadBytes / 1e9).toFixed(2) })
        : setup.recognitionPreparing ? t('preparingRecognition') : t(`phase.${active ? state.phase : 'idle'}`)
  return <section className={css.panel} data-voice-chat={active ? state.phase : status?.phase ?? 'connecting'} aria-label={t('open')}>
    <div className={css.row}>
      <span className={css.status} role="status">{(active || preparing) && <StateDot state="ongoing" />}{progress}</span>
      {active ? <Button size="sm" variant="outline" onClick={() => { stop(sessionId) }}>{t('end')}</Button>
        : usable ? <Button size="sm" variant="primary" onClick={() => { start(sessionId, initialReplies, Math.max(0, ...chat.timeline.turnOrder)) }}>{t('start')}</Button>
          : preparing ? <Button size="sm" onClick={cancelPreparation}>{t('cancelPrepare')}</Button>
            : status?.phase !== 'unsupported' && <Button size="sm" variant="outline" disabled={!setup.connected} onClick={prepare}>{t('prepare')}</Button>}
      <Button size="sm" className={css.close} aria-label={t('close')} onClick={close}><IconCloseOutlineRegular size={16} /></Button>
    </div>
    {!active && status?.model && !usable && <>
      <div className={css.details}>{t('selected', { model: t(`model.${status.model}`), gb: (status.downloadBytes / 1e9).toFixed(1) })}</div>
      <div className={css.details}>{t('recognition')}: {t(setup.recognitionReady ? 'ready' : 'unprepared')}</div>
      <div className={css.details}>{t('license')}</div>
    </>}
    {status?.operation === 'model' && <progress className={css.progress} value={status.completedBytes} max={status.downloadBytes} aria-label={t('synthesis')} />}
    {(state.error || status?.error) && <div className={css.error} role="alert">{state.error ? t(`error.${state.error}`)
      : status?.error === 'download' ? t('error.download') : t('error.runtime')}</div>}
    {state.transcript && <div className={css.transcript} aria-label={t('transcript')}>
      <span>{state.transcript}</span>
      {state.error === 'send' && <Button size="sm" onClick={() => { inputActions.insertText(state.transcript, inputActions.captureInsertion()) }}>{t('insert')}</Button>}
    </div>}
  </section>
}
