/** Optional Remote mounting and one plugin-owned microphone/playback lifetime. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-voice-chat/remote'
import type {} from '@deepseek-ai/dsh-experimental-api-speech-to-text/remote'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { SpeechCatalog } from '@deepseek-ai/dsh-experimental-api-speech-to-text/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { VoiceAudio, VoiceStatus } from '../types.ts'
import { VoiceConversation } from './controller.ts'
import { LiveAudio } from './audio.ts'
import { VoiceChatPanel, VoiceChatTrigger, type VoiceChatInjected, type VoiceSetup } from './VoiceChat.tsx'
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
    recognitionReady: false, recognitionPreparing: false, connected: false })
  const panel = createSnapshotStore<SessionId | null>(null)
  let catalog: SpeechCatalog | null = null, speechConnected = false, voiceConnected = false
  const synthesize = async (text: string, signal: AbortSignal, accept: (audio: VoiceAudio) => void): Promise<void> => {
    const stream = ctx.remote.voiceChat.synthesize(text, signal)
    try {
      for await (const audio of stream) { signal.throwIfAborted(); accept(audio) }
      signal.throwIfAborted()
    } finally { stream.dispose() }
  }
  const conversation = new VoiceConversation({
    createAudio: () => new LiveAudio(),
    warm: async (signal) => { if (options.value.warmupText !== '') await synthesize(options.value.warmupText, signal, () => {}) },
    retain: (sessionId, signal) => ctx.sessions.retain(sessionId, { source: 'voiceChat', signal }),
    catalog: () => catalog,
    transcribe: (audioBase64, signal) => ctx.remote.speech.transcribe({ audioBase64, ...catalog?.selection }, signal),
    synthesize,
  })
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
        setup.set({ ...setup.getSnapshot(), connected: voiceConnected,
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
  const hidden = (): void => { if (document.hidden) stop() }
  ctx.effect(() => {
    document.addEventListener('visibilitychange', hidden)
    return () => { document.removeEventListener('visibilitychange', hidden) }
  })
  const preparationFailed = (error: unknown): void => {
    ctx.logger.warn('Voice preparation request failed', error)
    conversation.state.set({ ...conversation.state.getSnapshot(), error: 'connection' })
  }
  const checked = (result: RemoteResult<void>): void => { if (!result.ok) throw result.error }
  const actions: VoiceChatInjected = {
    hooks: { voiceState: conversation.state, voiceSetup: setup, voicePanel: panel },
    open: (sessionId) => {
      const previous = conversation.state.getSnapshot()
      if (previous.phase === 'idle' && previous.sessionId !== sessionId) {
        conversation.state.set({ ...previous, sessionId, transcript: '', error: null })
      }
      panel.set(sessionId)
    }, close: () => { stop(); panel.set(null) },
    stop: (sessionId) => { if (conversation.state.getSnapshot().sessionId === sessionId) stop() },
    start: (sessionId, replies, turn) => {
      if (setup.getSnapshot().connected && setup.getSnapshot().recognitionReady && setup.getSnapshot().voice?.phase === 'ready') {
        void conversation.start(sessionId, options.value, replies, turn)
      }
    },
    observe: (sessionId, replies, turn) => { conversation.observe(sessionId, replies, turn) },
    prepare: () => {
      const providerId = catalog?.selection.providerId
      if (providerId && !setup.getSnapshot().recognitionReady) {
        void ctx.remote.speech.prepare(providerId).then(checked).catch(preparationFailed)
      }
      if (setup.getSnapshot().voice?.phase !== 'ready') void ctx.remote.voiceChat.prepare().then(checked).catch(preparationFailed)
    },
    cancelPreparation: () => {
      const providerId = catalog?.selection.providerId
      if (providerId && setup.getSnapshot().recognitionPreparing) {
        void ctx.remote.speech.cancelPreparation(providerId).then(checked).catch(preparationFailed)
      }
      void ctx.remote.voiceChat.cancelPreparation().then(checked).catch(preparationFailed)
    },
  }
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'voice-chat', locale: NS, inject: () => actions }, VoiceChatTrigger))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'voice-chat', locale: NS, inject: () => actions }, VoiceChatPanel))
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
