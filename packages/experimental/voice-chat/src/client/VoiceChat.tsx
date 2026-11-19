/** Composer entry and independent voice views preserve the written conversation's layout. */
import { useEffect, useMemo } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { VoiceOptions, VoicePreset, VoiceStatus } from '../types.ts'
import type { SpeechCatalog } from '@deepseek-ai/dsh-experimental-api-speech-to-text/types'
import type { SpeechSelectionPatch } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { VoiceDevices, VoiceInputDevice } from './devices.ts'
import type { ConversationVoiceState } from './controller.ts'
import type { VoiceReply } from './replies.ts'
import { Button, IconCloseOutlineRegular, IconMicrophoneOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { VoiceOrb } from './VoiceOrb.tsx'
import { NS } from './locales.ts'
import css from './VoiceChat.module.css'

/** Preparation mirrors and interaction callbacks created by this plugin's registration. */
export interface VoiceChatInjected {
  hooks: {
    voiceState: HostObservable<ConversationVoiceState>
    voiceSetup: HostObservable<VoiceSetup>
    voiceSetupNotice: HostObservable<SessionId | null>
    voiceInputDevice: HostObservable<VoiceInputDevice>
    voiceDevices: HostObservable<VoiceDevices>
    voiceSettingsAvailable: HostObservable<boolean>
    voicePreference: HostObservable<VoicePreset>
  }
  showSetupNotice: (sessionId: SessionId) => void
  close: () => void
  prepare: () => void
  cancelPreparation: () => void
  openSettings: () => void
  refreshInputDevices: (requestAccess: boolean) => void
  selectInputDevice: (device: VoiceInputDevice) => void
  configureRecognition: (patch: SpeechSelectionPatch) => Promise<void>
  selectVoice: (voice: VoicePreset) => void
  toggleMicrophone: () => void
  toggleSpeaker: () => void
  start: (sessionId: SessionId, replies: readonly VoiceReply[], turn: number, step: number) => void
  stop: (sessionId: SessionId) => void
  observe: (sessionId: SessionId, replies: readonly VoiceReply[], turn: number, running: boolean, step: number) => void
}

/** Complete local observations; connection failures never masquerade as ready. */
export interface VoiceSetup {
  readonly voice: VoiceStatus | null
  readonly options: VoiceOptions | null
  readonly recognitionReady: boolean
  readonly recognitionPreparing: boolean
  readonly connected: boolean
  readonly recognition: SpeechCatalog | null
  readonly preparationError: boolean
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Session-bound voice action nested under the resident composer's optional primary entry. */
    'voiceChat.primary': { kind: 'single'; scope: 'session'; owner: { readonly locked: boolean } }
  }
}

type TriggerProps = PropsRuntime<'conversation.input.primary'> & PropsLocale<typeof NS> & PropsRenderSlots<'voiceChat.primary'>
type SessionTriggerProps = PropsRuntime<'voiceChat.primary'> & PropsLocale<typeof NS> & InjectFace<VoiceChatInjected>
type PanelProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<typeof NS> & InjectFace<VoiceChatInjected>
type ObserverProps = PropsRuntime<'conversation.content.overlay'> & InjectFace<VoiceChatInjected>
type ControlsProps = PropsRuntime<'conversation.input.right'> & PropsLocale<typeof NS> & InjectFace<VoiceChatInjected>

function voicePosition(chat: ChatSnapshot): { turn: number; step: number } {
  const turn = chat.timeline.turnOrder.at(-1) ?? 0
  return { turn, step: chat.timeline.turns.get(turn)?.steps.at(-1)?.step ?? 0 }
}

function voiceReplies(chat: ChatSnapshot): VoiceReply[] {
  const replies: VoiceReply[] = chat.legacy.nodes.flatMap(node => node.kind === 'assistant' && !node.interrupted
    ? [{ key: `${node.turn}/${node.step}`, turn: node.turn, step: node.step,
      text: node.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join(''), final: true }] : [])
  const partial = chat.legacy.partial
  if (partial) replies.push({ key: `${partial.turn}/${partial.step}`, turn: partial.turn, step: partial.step,
    text: partial.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join(''), final: false })
  return replies
}

/** Keep the voice entry visible before a workspace has supplied a Session. */
export function VoiceChatTrigger({ sessionId, locked, requestWorkspace, renderSlot, t }: TriggerProps) {
  if (sessionId !== undefined) return renderSlot('voiceChat.primary', { locked })
  return <Tooltip label={t('open')} side="top" delayMs={500} portal>
    <Button size="sm" variant="primary" className={css.trigger} aria-label={t('open')}
      disabled={requestWorkspace === undefined} onClick={requestWorkspace}><span className={css.waveIcon} aria-hidden /></Button>
  </Tooltip>
}

/** Start a prepared voice conversation from the empty composer, or open its plugin configuration. */
export function VoiceChatSessionTrigger({ sessionId, showSetupNotice, start, openSettings, useVoiceSetup, useVoiceState, useChat,
  locked, useVoiceSettingsAvailable, t }: SessionTriggerProps) {
  const ready = useVoiceSetup(value => value.connected && value.recognitionReady && value.voice?.phase === 'ready')
  const phase = useVoiceState(value => value.sessionId === sessionId ? value.phase : 'idle')
  const chat = useChat(value => value)
  const settingsAvailable = useVoiceSettingsAvailable(value => value)
  if (phase !== 'idle') return null
  const run = (): void => {
    if (!ready) {
      if (settingsAvailable) openSettings(); else showSetupNotice(sessionId)
      return
    }
    const position = voicePosition(chat)
    start(sessionId, voiceReplies(chat), position.turn, position.step)
  }
  return <Tooltip label={t('open')} side="top" delayMs={500} portal>
    <Button size="sm" variant="primary" className={css.trigger} aria-label={t('open')} data-voice-ready={ready}
      disabled={locked} onClick={run}><span className={css.waveIcon} aria-hidden /></Button>
  </Tooltip>
}

/** Retain voice observation across composer changes, stopping capture when the Session leaves. */
export function VoiceChatObserver(props: ObserverProps) {
  const { sessionId, useVoiceState, stop } = props
  const active = useVoiceState(value => value.sessionId === sessionId && value.phase !== 'idle')
  useEffect(() => () => { stop(sessionId) }, [sessionId, stop])
  return active ? <VoiceReplyObserver {...props} /> : null
}

function VoiceReplyObserver({ sessionId, useChat, useSession, observe }: ObserverProps) {
  const chat = useChat(value => value)
  const replies = useMemo(() => voiceReplies(chat), [chat])
  const { turn, step } = voicePosition(chat)
  const running = useSession(value => value.running)
  useEffect(() => {
    observe(sessionId, replies, turn, running, step)
  }, [replies, sessionId, observe, running, turn, step])
  return null
}

/** Center the voice orb over the composer while leaving the Chat and draft in the document flow. */
export function VoiceChatPanel({ sessionId, useVoiceState, useVoiceSetupNotice, inputActions, close, t }: PanelProps) {
  const state = useVoiceState(value => value.sessionId === sessionId ? value : null)
  const setupNotice = useVoiceSetupNotice(value => value === sessionId)
  const phase = state?.phase ?? 'idle'
  const error = state?.error
  if (phase === 'idle' && !error && !setupNotice) return null
  const preparing = phase === 'requesting' || phase === 'warming'
  return <section className={css.stage} data-voice-chat={phase} data-composer-hero-replacement={phase === 'idle' ? undefined : ''}
    aria-label={t('open')}>
    {phase !== 'idle' && <div className={css.orbSeat}>
      <VoiceOrb phase={phase} />
      <span className={preparing ? css.preparing : css.screenReaderStatus} role="status">
        {t(phase === 'listening' && state?.microphoneMuted ? 'microphoneMuted' : `phase.${phase}`)}
      </span>
    </div>}
    {(error || setupNotice) && <div className={css.notice}>
      <span role={error ? 'alert' : 'status'}>{error ? t(`error.${error}`) : t('settingsUnavailable')}</span>
      <Button size="sm" className={css.close} aria-label={t('close')} onClick={close}><IconCloseOutlineRegular size={16} /></Button>
    </div>}
    {error === 'send' && state?.transcript && <div className={css.transcript} aria-label={t('transcript')}>
      <span>{state.transcript}</span>
      <Button size="sm" onClick={() => { inputActions.insertText(state.transcript, inputActions.captureInsertion()) }}>{t('insert')}</Button>
    </div>}
  </section>
}

/** Keep active voice controls beside the model and leave explicit Send or Stop to the composer. */
export function VoiceChatControls({ sessionId, useVoiceState, toggleSpeaker, toggleMicrophone, close, t }: ControlsProps) {
  const state = useVoiceState(value => value.sessionId === sessionId && value.phase !== 'idle' ? value : null)
  if (!state) return null
  const stopping = state.phase === 'stopping'
  const microphone = t(state.microphoneMuted ? 'unmuteMicrophone' : 'muteMicrophone')
  const speaker = t(state.speakerMuted ? 'unmuteSpeaker' : 'muteSpeaker')
  return <div className={css.controls} data-composer-exclusive-activity data-voice-controls>
    <Tooltip label={speaker} side="top" delayMs={500} portal>
      <Button size="sm" className={css.iconControl} aria-label={speaker} aria-pressed={state.speakerMuted}
        disabled={stopping} onClick={toggleSpeaker}>
        <span className={state.speakerMuted ? css.mutedGlyph : undefined}><span className={css.speakerIcon} aria-hidden /></span>
      </Button>
    </Tooltip>
    <Tooltip label={microphone} side="top" delayMs={500} portal>
      <Button size="sm" className={`${css.iconControl} ${css.microphone}`} aria-label={microphone} aria-pressed={state.microphoneMuted}
        disabled={stopping} onClick={toggleMicrophone}>
        <span className={state.microphoneMuted ? css.mutedGlyph : undefined}><IconMicrophoneOutlineRegular size={18} /></span>
      </Button>
    </Tooltip>
    <Tooltip label={t('end')} side="top" delayMs={500} portal>
      <Button size="sm" className={`${css.iconControl} ${css.end}`} aria-label={t('end')}
        disabled={stopping} onClick={close}><IconCloseOutlineRegular size={18} /></Button>
    </Tooltip>
  </div>
}
