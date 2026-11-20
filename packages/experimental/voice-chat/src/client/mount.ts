/** Optional Remote mounting and one plugin-owned microphone/playback lifetime. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-voice-chat/remote'
import type {} from '@deepseek-ai/dsh-experimental-api-speech-to-text/remote'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { SpeechCatalog } from '@deepseek-ai/dsh-experimental-api-speech-to-text/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { VoiceStatus } from '../types.ts'
import { VoiceConversation, type VoiceConversationDependencies } from './controller.ts'
import { LiveAudio, VoiceAudioError } from './audio.ts'
import { createVoiceInputDevice, discoverVoiceInputs, type VoiceDevices } from './devices.ts'
import { createVoicePreference } from './voices.ts'
import { VoiceChatSettings } from './VoiceChatSettings.tsx'
import { connectDesktopVoice } from './desktop.ts'
import { VoiceChatControls, VoiceChatObserver, VoiceChatPanel, VoiceChatTrigger, VoiceChatSessionTrigger, type VoiceChatInjected, type VoiceSetup } from './VoiceChat.tsx'
import { NS, en, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { /** Explicitly active browser voice conversation. */ voiceChat: unknown }
}

/** Client infrastructure needed before the optional voice namespace is mounted. */
export const inject = ['remote', 'slots', 'locale', 'sessions']

async function registerUi(ctx: Context): Promise<void> {
  const options = await ctx.remote.voiceChat.options()
  if (!options.ok) throw options.error
  const setup = createSnapshotStore<VoiceSetup>({ voice: null, options: options.value,
    recognitionReady: false, recognitionPreparing: false, connected: false, recognition: null, preparationError: false })
  const setupNotice = createSnapshotStore<SessionId | null>(null)
  const inputDevice = createVoiceInputDevice()
  const voicePreference = createVoicePreference(options.value.voice)
  const inputDevices = createSnapshotStore<VoiceDevices>({ devices: [], pending: false, error: null })
  const settingsAvailable = createSnapshotStore(false)
  const deviceLifetime = new AbortController()
  let deviceRequest = 0
  ctx.effect(() => () => { deviceLifetime.abort() })
  ctx.inject(['pluginNavigation'], (scope: Context) => {
    scope.effect(() => { settingsAvailable.set(true); return () => { settingsAvailable.set(false) } })
  })
  const refreshDevices = (requestAccess: boolean): void => {
    const request = ++deviceRequest
    inputDevices.set({ ...inputDevices.getSnapshot(), pending: true, error: null })
    void discoverVoiceInputs(requestAccess, inputDevice.getSnapshot().id, deviceLifetime.signal).then((devices) => {
      if (!deviceLifetime.signal.aborted && request === deviceRequest) inputDevices.set({ devices, pending: false, error: null })
    }).catch((error: unknown) => {
      if (deviceLifetime.signal.aborted || request !== deviceRequest) return
      inputDevices.set({ ...inputDevices.getSnapshot(), pending: false,
        error: error instanceof VoiceAudioError && error.kind === 'permission' ? 'permission'
          : error instanceof VoiceAudioError && error.kind === 'unsupported' ? 'unsupported' : 'device' })
    })
  }
  ctx.effect(() => {
    const media = (navigator as Partial<Navigator>).mediaDevices
    const changed = (): void => { refreshDevices(false) }
    media?.addEventListener('devicechange', changed)
    return () => { media?.removeEventListener('devicechange', changed) }
  })
  let catalog: SpeechCatalog | null = null, speechConnected = false, voiceConnected = false
  const synthesize: VoiceConversationDependencies['synthesize'] = async (text, voice, signal, accept) => {
    const stream = ctx.remote.voiceChat.synthesize({ text, voice }, signal)
    try {
      for await (const audio of stream) { signal.throwIfAborted(); accept(audio) }
      signal.throwIfAborted()
    } finally { stream.dispose() }
  }
  const conversation = new VoiceConversation({
    createAudio: () => new LiveAudio(inputDevice.getSnapshot().id),
    warm: async (voice, signal) => { if (options.value.warmupText !== '') await synthesize(options.value.warmupText, voice, signal, () => {}) },
    retain: (sessionId, signal) => ctx.sessions.retain(sessionId, { source: 'voiceChat', signal }),
    catalog: () => catalog,
    transcribe: (audioBase64, signal) => ctx.remote.speech.transcribe({ audioBase64, ...catalog?.selection }, signal),
    synthesize,
  })
  const desktopAvailable = connectDesktopVoice(ctx, conversation)
  const disconnect = (): void => {
    setup.set({ ...setup.getSnapshot(), connected: false })
    if (conversation.state.getSnapshot().phase !== 'idle') {
      void conversation.stop().catch((error: unknown) => { ctx.logger.warn('Voice audio cleanup failed', error) })
      conversation.state.set({ ...conversation.state.getSnapshot(), error: 'connection' })
    }
  }
  const recognition = ctx.remote.$stream<SpeechCatalog>({ name: 'Voice conversation recognition readiness',
    open: signal => ctx.remote.speech.follow(signal), ended: () => new Error('Voice recognition observation ended'),
    carrierFailed: () => { speechConnected = false; disconnect() },
  })
  const synthesis = ctx.remote.$stream<VoiceStatus>({ name: 'Voice synthesis readiness',
    open: signal => ctx.remote.voiceChat.follow(signal), ended: () => new Error('Voice synthesis observation ended'),
    carrierFailed: () => { voiceConnected = false; disconnect() },
  })
  let disposed = false
  const isDisposed = (): boolean => disposed
  const observeRecognition = (async () => {
    try {
      for await (const item of recognition) {
        catalog = item.value; speechConnected = true
        const phase = catalog.providers.find(provider => provider.id === catalog?.selection.providerId)?.preparation.phase
        setup.set({ ...setup.getSnapshot(), connected: voiceConnected, recognition: catalog,
          recognitionReady: phase === 'ready' || phase === 'standby' || phase === 'waking',
          recognitionPreparing: phase === 'checking' || phase === 'downloading' || phase === 'loading' })
        item.accept()
      }
    } catch (error) { if (!isDisposed()) { disconnect(); ctx.logger.warn('Voice recognition observation failed', error) } }
  })()
  const observeSynthesis = (async () => {
    try {
      for await (const item of synthesis) {
        voiceConnected = true
        setup.set({ ...setup.getSnapshot(), connected: speechConnected, voice: item.value })
        item.accept()
      }
    } catch (error) { if (!isDisposed()) { disconnect(); ctx.logger.warn('Voice synthesis observation failed', error) } }
  })()
  ctx.effect(() => async () => {
    disposed = true
    await conversation.stop()
    await Promise.all([recognition.dispose(), synthesis.dispose()])
    await Promise.all([observeRecognition, observeSynthesis])
  })
  ctx.effect(() => ctx.locale.register(NS, { en, zh }))
  const stop = (): void => { void conversation.stop().catch((error: unknown) => { ctx.logger.warn('Voice audio cleanup failed', error) }) }
  const hidden = (): void => { if (document.hidden && !desktopAvailable.getSnapshot()) stop() }
  ctx.effect(() => {
    document.addEventListener('visibilitychange', hidden)
    return () => { document.removeEventListener('visibilitychange', hidden) }
  })
  const preparationFailed = (error: unknown): void => {
    ctx.logger.warn('Voice preparation request failed', error)
    setup.set({ ...setup.getSnapshot(), preparationError: true })
  }
  const checked = (result: RemoteResult<void>): void => { if (!result.ok) throw result.error }
  const actions: VoiceChatInjected = {
    hooks: { voiceState: conversation.state, voiceInputLevel: conversation.inputLevel, voiceSetup: setup, voiceSetupNotice: setupNotice,
      voiceInputDevice: inputDevice, voiceDevices: inputDevices, voiceSettingsAvailable: settingsAvailable, voicePreference },
    toggleMicrophone: () => { conversation.toggleMicrophone() },
    toggleSpeaker: () => { conversation.toggleSpeaker() },
    openSettings: () => { ctx.get('pluginNavigation')?.openBundle('@deepseek-ai/dsh-voice-chat-bundle') },
    refreshInputDevices: refreshDevices,
    selectInputDevice: (device) => { inputDevice.set(device) },
    selectVoice: (voice) => { voicePreference.set(voice) },
    configureRecognition: async (patch) => {
      const result = await ctx.remote.speech.configure(patch)
      if (!result.ok) { ctx.logger.warn('Voice recognition configuration failed', result.error); throw result.error }
    },
    showSetupNotice: (sessionId) => { setupNotice.set(sessionId) },
    close: () => {
      void conversation.stop(true).catch((error: unknown) => { ctx.logger.warn('Voice audio cleanup failed', error) })
    },
    dismissNotice: () => {
      setupNotice.set(null)
      const state = conversation.state.getSnapshot()
      conversation.state.set({ ...state, error: state.error === 'cleanup' ? state.error : null,
        transcript: state.phase === 'idle' || state.phase === 'stopping' ? '' : state.transcript })
    },
    stop: (sessionId) => { if (conversation.state.getSnapshot().sessionId === sessionId) stop() },
    start: (sessionId, replies, turn, step) => {
      if (setup.getSnapshot().connected && setup.getSnapshot().recognitionReady && setup.getSnapshot().voice?.phase === 'ready') {
        setupNotice.set(null)
        void conversation.start(sessionId, { ...options.value, voice: voicePreference.getSnapshot() }, replies, turn, step)
      }
    },
    observe: (sessionId, replies, turn, running, step) => { conversation.observe(sessionId, replies, turn, running, step) },
    prepare: () => {
      setup.set({ ...setup.getSnapshot(), preparationError: false })
      const providerId = catalog?.selection.providerId
      if (providerId && !setup.getSnapshot().recognitionReady) {
        void ctx.remote.speech.prepare(providerId).then(checked).catch(preparationFailed)
      }
      if (setup.getSnapshot().voice?.phase !== 'ready') void ctx.remote.voiceChat.prepare().then(checked).catch(preparationFailed)
    },
    cancelPreparation: () => {
      setup.set({ ...setup.getSnapshot(), preparationError: false })
      const providerId = catalog?.selection.providerId
      if (providerId && setup.getSnapshot().recognitionPreparing) {
        void ctx.remote.speech.cancelPreparation(providerId).then(checked).catch(preparationFailed)
      }
      void ctx.remote.voiceChat.cancelPreparation().then(checked).catch(preparationFailed)
    },
  }
  ctx.slots.inject('conversation.input.primary', function* () {
    yield ctx.slots.register({ name: 'conversation.input.primary', select: owner => owner.idle ? true : null,
      children: { 'voiceChat.primary': { kind: 'single', scope: 'session' } }, locale: NS }, VoiceChatTrigger)
    yield ctx.slots.register({ name: 'voiceChat.primary', locale: NS, inject: () => actions }, VoiceChatSessionTrigger)
  })
  ctx.slots.inject('conversation.content.overlay', () => ctx.slots.register({
    name: 'conversation.content.overlay', id: 'voice-chat', inject: () => actions }, VoiceChatObserver))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'voice-chat', order: 100, locale: NS, inject: () => actions }, VoiceChatPanel))
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'voice-chat', locale: NS, inject: () => actions }, VoiceChatControls))
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: '@deepseek-ai/dsh-voice-chat-bundle', locale: NS, inject: () => actions }, VoiceChatSettings))

}

/**
 * Mount local voice controls after speech recognition is available.
 * @param ctx - Client plugin owner.
 * @param contribution - this package's generated synthesis Remote.
 * @returns disposer joining microphone release, observers, UI, and Remote withdrawal.
 */
export async function mountVoiceChat(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.voiceChat', 'remote.speech', 'slots', 'locale', 'sessions'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await unmount(); throw error }
  return async () => { await ui.dispose(); await unmount() }
}
