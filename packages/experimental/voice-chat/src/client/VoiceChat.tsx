/** Compact composer controls keep tool approvals and the written conversation accessible. */
import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { VoiceOptions, VoiceStatus } from '../types.ts'
import type { SpeechCatalog } from '@deepseek-ai/dsh-experimental-api-speech-to-text/types'
import type { SpeechSelectionPatch } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { VoiceDevices, VoiceInputDevice } from './devices.ts'
import type { ConversationVoiceState } from './controller.ts'
import type { VoiceReply } from './replies.ts'
import { Button, IconChevronDownOutlineRegular, IconCloseOutlineRegular, IconMicrophoneOutlineRegular, StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { NS } from './locales.ts'
import css from './VoiceChat.module.css'

/** Preparation mirrors and interaction callbacks created by this plugin's registration. */
export interface VoiceChatInjected {
  hooks: {
    voiceState: HostObservable<ConversationVoiceState>
    voiceSetup: HostObservable<VoiceSetup>
    voicePanel: HostObservable<VoicePanelView>
    voiceInputDevice: HostObservable<VoiceInputDevice>
    voiceDevices: HostObservable<VoiceDevices>
    voiceSettingsAvailable: HostObservable<boolean>
    voiceDesktopAvailable: HostObservable<boolean>
  }
  open: (sessionId: SessionId) => void
  close: () => void
  prepare: () => void
  cancelPreparation: () => void
  openSettings: () => void
  refreshInputDevices: (requestAccess: boolean) => void
  selectInputDevice: (device: VoiceInputDevice) => void
  configureRecognition: (patch: SpeechSelectionPatch) => Promise<void>
  toggleMicrophone: () => void
  toggleSpeaker: () => void
  minimize: () => void
  restorePanel: () => void
  start: (sessionId: SessionId, replies: readonly VoiceReply[], turn: number) => void
  stop: (sessionId: SessionId) => void
  observe: (sessionId: SessionId, replies: readonly VoiceReply[], turn: number) => void
}

/** Shared presentation choice; audio remains owned by the conversation controller. */
export interface VoicePanelView { readonly sessionId: SessionId | null; readonly compact: boolean }

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

/** Keep the voice entry visible before a workspace has supplied a Session. */
export function VoiceChatTrigger({ sessionId, locked, requestWorkspace, renderSlot, t }: TriggerProps) {
  if (sessionId !== undefined) return renderSlot('voiceChat.primary', { locked })
  return <Tooltip label={t('open')} side="top" delayMs={500} portal>
    <Button size="sm" variant="primary" className={css.trigger} aria-label={t('open')}
      disabled={requestWorkspace === undefined} onClick={requestWorkspace}><span className={css.waveIcon} aria-hidden /></Button>
  </Tooltip>
}

/** Start a prepared voice conversation from the empty composer, or open its plugin configuration. */
export function VoiceChatSessionTrigger({ sessionId, open, start, stop, openSettings, useVoiceSetup, useVoiceState, useChat,
  locked, useVoiceSettingsAvailable, t }: SessionTriggerProps) {
  const setup = useVoiceSetup(value => value), state = useVoiceState(value => value), chat = useChat(value => value)
  const settingsAvailable = useVoiceSettingsAvailable(value => value)
  const active = state.sessionId === sessionId && state.phase !== 'idle'
  const label = t(active ? 'end' : 'open')
  const run = (): void => {
    if (active) { stop(sessionId); return }
    if (!setup.connected || !setup.recognitionReady || setup.voice?.phase !== 'ready') {
      if (settingsAvailable) openSettings(); else open(sessionId)
      return
    }
    const replies: VoiceReply[] = chat.legacy.nodes.flatMap(node => node.kind === 'assistant'
      ? [{ key: `${node.turn}/${node.step}`, turn: node.turn,
        text: node.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join(''), final: true }] : [])
    open(sessionId); start(sessionId, replies, Math.max(0, ...chat.timeline.turnOrder))
  }
  return <Tooltip label={label} side="top" delayMs={500} portal>
    <Button size="sm" variant="primary" className={css.trigger} aria-label={label} data-voice-ready={setup.connected && setup.recognitionReady && setup.voice?.phase === 'ready'}
      disabled={state.phase === 'stopping' || locked} onClick={run}>
      {active ? <IconCloseOutlineRegular size={20} /> : <span className={css.waveIcon} aria-hidden />}
    </Button>
  </Tooltip>
}

/** Render preparation and the active voice controls above the existing composer. */
export function VoiceChatPanel({ sessionId, useVoicePanel, useVoiceState, useVoiceSetup, useChat,
  useVoiceSettingsAvailable, useVoiceDesktopAvailable, inputActions, close, openSettings, start, stop, observe,
  toggleMicrophone, toggleSpeaker, minimize, restorePanel, t }: PanelProps) {
  const view = useVoicePanel(value => value)
  const opened = view.sessionId === sessionId, compact = opened && view.compact
  const state = useVoiceState(value => value), setup = useVoiceSetup(value => value)
  const settingsAvailable = useVoiceSettingsAvailable(value => value)
  const desktopAvailable = useVoiceDesktopAvailable(value => value)
  const moved = useRef(false)
  const focusControl = useCallback((button: HTMLButtonElement | null) => {
    if (button && moved.current) { button.focus({ preventScroll: true }); moved.current = false }
  }, [])
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
  if (!opened || (compact && !active && state.error === null)) return null
  const status = setup.voice
  const usable = setup.connected && setup.recognitionReady && status?.phase === 'ready'
  const preparing = setup.recognitionPreparing || status?.phase === 'preparing'
  const initialReplies: VoiceReply[] = chat.legacy.nodes.flatMap(node => node.kind === 'assistant'
    ? [{ key: `${node.turn}/${node.step}`, turn: node.turn,
      text: node.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join(''), final: true }] : [])
  const progress = !setup.connected ? t('connecting') : !usable && !active ? t(preparing ? 'preparingSettings' : 'setupRequired')
    : active && state.microphoneMuted && state.phase === 'listening' ? t('microphoneMuted') : t(`phase.${active ? state.phase : 'idle'}`)
  const content = <section className={compact ? css.floatingPanel : css.panel} data-voice-floating={compact ? '' : undefined}
    data-voice-chat={active ? state.phase : status?.phase ?? 'connecting'} aria-label={t('open')}>
    {active && <div className={css.orb} data-phase={state.phase} data-muted={state.microphoneMuted} aria-hidden />}
    <div className={css.row}>
      <span className={css.status} role="status">{(active || preparing) && <StateDot state="ongoing" />}{progress}</span>
      {active ? <>
        <Tooltip label={t(state.microphoneMuted ? 'unmuteMicrophone' : 'muteMicrophone')} side="top" delayMs={500} portal>
          <Button size="sm" className={css.iconControl} aria-label={t(state.microphoneMuted ? 'unmuteMicrophone' : 'muteMicrophone')}
            aria-pressed={state.microphoneMuted} disabled={state.phase === 'stopping'} onClick={toggleMicrophone}>
            <span className={state.microphoneMuted ? css.mutedGlyph : undefined}><IconMicrophoneOutlineRegular size={18} /></span>
          </Button>
        </Tooltip>
        <Tooltip label={t(state.speakerMuted ? 'unmuteSpeaker' : 'muteSpeaker')} side="top" delayMs={500} portal>
          <Button size="sm" className={css.iconControl} aria-label={t(state.speakerMuted ? 'unmuteSpeaker' : 'muteSpeaker')}
            aria-pressed={state.speakerMuted} disabled={state.phase === 'stopping'} onClick={toggleSpeaker}>
            <span className={state.speakerMuted ? css.mutedGlyph : undefined}><span className={css.speakerIcon} aria-hidden /></span>
          </Button>
        </Tooltip>
        <Tooltip label={t(compact ? 'restorePanel' : desktopAvailable ? 'minimize' : 'minimizePanel')} side="top" delayMs={500} portal>
          <Button ref={focusControl} size="sm" className={css.iconControl}
            aria-label={t(compact ? 'restorePanel' : desktopAvailable ? 'minimize' : 'minimizePanel')}
            onClick={() => {
              if (!desktopAvailable) moved.current = true
              if (compact) restorePanel(); else minimize()
            }}><span className={compact ? css.restoreIcon : undefined}><IconChevronDownOutlineRegular size={18} /></span></Button>
        </Tooltip>
        <Button size="sm" variant="outline" disabled={state.phase === 'stopping'} onClick={() => { stop(sessionId) }}>{t('end')}</Button>
      </>
        : usable ? <Button size="sm" variant="primary" onClick={() => { start(sessionId, initialReplies, Math.max(0, ...chat.timeline.turnOrder)) }}>{t('start')}</Button>
          : settingsAvailable && <Button size="sm" variant="outline" onClick={openSettings}>{t('configure')}</Button>}
      {!active && <Button size="sm" className={css.close} aria-label={t('close')} onClick={close}><IconCloseOutlineRegular size={16} /></Button>}
    </div>
    {!active && !usable && !settingsAvailable && <div className={css.details}>{t('settingsUnavailable')}</div>}
    {state.error && <div className={css.error} role="alert">{t(`error.${state.error}`)}</div>}
    {state.transcript && <div className={css.transcript} aria-label={t('transcript')}>
      <span>{state.transcript}</span>
      {state.error === 'send' && <Button size="sm" onClick={() => { inputActions.insertText(state.transcript, inputActions.captureInsertion()) }}>{t('insert')}</Button>}
    </div>}
  </section>
  return compact ? createPortal(content, document.body) : content
}
