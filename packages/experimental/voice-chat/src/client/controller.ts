/** Browser-owned voice conversation; ordinary Session submission owns all model-visible text. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionFace, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SpeechCatalog } from '@deepseek-ai/dsh-experimental-api-speech-to-text/types'
import type { Transcript } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { VoiceAudio, VoiceOptions } from '../types.ts'
import { base64Audio, LiveAudio, VoiceAudioError } from './audio.ts'
import { ReplySentences, type VoiceReply } from './replies.ts'

/** Localized failure identities; raw transport or model errors never become UI copy. */
export type VoiceFailure = 'permission' | 'device' | 'unsupported' | 'playback' | 'recognition' | 'send' | 'synthesis' | 'connection' | 'tooLong'
/** Transient interaction state, independent of the durable Session. */
export interface ConversationVoiceState {
  /** Session owning the active microphone or the retained transcript while idle. */
  readonly sessionId: SessionId | null
  readonly phase: 'idle' | 'requesting' | 'warming' | 'listening' | 'recording' | 'transcribing' | 'thinking' | 'speaking'
  readonly transcript: string
  readonly error: VoiceFailure | null
}

/** Host and Session callbacks captured by the Client registration. */
export interface VoiceConversationDependencies {
  readonly createAudio: () => Pick<LiveAudio, 'start' | 'play' | 'interrupt' | 'dispose'>
  readonly warm: (signal: AbortSignal) => Promise<void>
  readonly retain: (sessionId: SessionId, signal: AbortSignal) => SessionReference
  readonly catalog: () => SpeechCatalog | null
  readonly transcribe: (audioBase64: string, signal: AbortSignal) => Promise<RemoteResult<Transcript>>
  readonly synthesize: (text: string, signal: AbortSignal, accept: (audio: VoiceAudio) => void) => Promise<void>
}

interface ActiveVoice {
  readonly sessionId: SessionId
  readonly abort: AbortController
  readonly audio: Pick<LiveAudio, 'start' | 'play' | 'interrupt' | 'dispose'>
  readonly reference: SessionReference
  readonly sentences: ReplySentences
  turn: AbortController
  session?: SessionFace
  afterTurn: number
  latestTurn: number
  admitting: boolean
  cancellation: Promise<void>
  speech: Promise<void>
  readonly maxPendingSentences: number
  pendingSentences: number
}

/** Owns one active voice conversation and releases it before another may start. */
export class VoiceConversation {
  /** Transient microphone, playback, transcript, and recovery state for the registered UI. */
  readonly state = createSnapshotStore<ConversationVoiceState>({ sessionId: null, phase: 'idle', transcript: '', error: null })
  private active: ActiveVoice | undefined
  private release: Promise<void> = Promise.resolve()

  constructor(private readonly dependencies: VoiceConversationDependencies) {}

  /**
   * Start a user-authorized continuous microphone lifetime for one Session.
   * @param sessionId - currently displayed Session.
   * @param options - Host-owned voice limits.
   * @param replies - existing text, remembered without playback.
   * @param latestTurn - current Session turn watermark, including an unfinished turn.
   * @returns after capture and Session retention are ready; failures remain visible in state.
   */
  async start(sessionId: SessionId, options: VoiceOptions, replies: readonly VoiceReply[], latestTurn: number): Promise<void> {
    if (this.active) return
    const abort = new AbortController(), audio = this.dependencies.createAudio()
    const reference = this.dependencies.retain(sessionId, abort.signal)
    const active: ActiveVoice = { sessionId, abort, audio, reference, sentences: new ReplySentences(options.maxSentenceCharacters),
      turn: new AbortController(), afterTurn: latestTurn, latestTurn, admitting: false,
      cancellation: Promise.resolve(), speech: Promise.resolve(),
      maxPendingSentences: options.maxPendingSentences, pendingSentences: 0 }
    for (const reply of replies) active.sentences.take(reply, true)
    this.active = active
    this.update({ sessionId, phase: 'requesting', transcript: '', error: null })
    try {
      await this.release
      abort.signal.throwIfAborted()
      const binding = reference.ready.then((value) => {
        if (!abort.signal.aborted) active.session = value.session
        return value
      })
      const capture = audio.start(options, () => { this.speechStarted(active) }, (bytes) => { void this.submit(active, bytes) },
        (error) => { this.fail(active, error.kind) }).then(() => {
        if (!abort.signal.aborted && this.state.getSnapshot().phase === 'requesting') this.update({ phase: 'warming' })
      })
      const warming = this.dependencies.warm(abort.signal).catch((error: unknown) => {
        if (!abort.signal.aborted) this.fail(active, 'synthesis')
        throw error
      })
      await Promise.all([binding, capture, warming])
      abort.signal.throwIfAborted()
      if (this.state.getSnapshot().phase === 'warming') this.update({ phase: 'listening' })
    } catch (error) { if (!abort.signal.aborted) this.fail(active, error instanceof VoiceAudioError ? error.kind : 'device') }
  }

  private speechStarted(active: ActiveVoice): void {
    if (this.active !== active) return
    active.turn.abort(); active.audio.interrupt(); active.turn = new AbortController()
    active.afterTurn = active.latestTurn; active.admitting = false
    this.update({ phase: 'recording', error: null })
    const session = active.session
    if (!session?.getSnapshot().running) return
    active.cancellation = session.cancel().then((result) => {
      if (!result.ok) throw result.error
    }).catch(() => { if (this.active === active) this.fail(active, 'send') })
  }

  private async submit(active: ActiveVoice, bytes: Uint8Array): Promise<void> {
    if (this.active !== active) return
    const signal = AbortSignal.any([active.abort.signal, active.turn.signal])
    const catalog = this.dependencies.catalog()
    if (!catalog || bytes.length > catalog.maxAudioBytes) { this.fail(active, 'recognition'); return }
    this.update({ phase: 'transcribing' })
    let operation: VoiceFailure = 'recognition'
    try {
      const result = await this.dependencies.transcribe(base64Audio(bytes), signal)
      signal.throwIfAborted()
      if (!result.ok) throw result.error
      const text = result.value.text.trim()
      if (text === '') { this.update({ phase: 'listening' }); return }
      this.update({ transcript: text })
      operation = 'send'
      await active.cancellation
      signal.throwIfAborted()
      const session = active.session
      if (!session) throw new Error('Voice Session is not ready')
      active.admitting = true
      this.update({ phase: 'thinking' })
      const mode = session.getSnapshot().running ? 'steer' : 'queue'
      const submission = session.beginSubmission({ mode, text, attachments: [] })
      const sent = await session.prompt([{ type: 'text', text }], mode, signal, submission.requestId)
      signal.throwIfAborted()
      if (!sent.ok) throw sent.error
    } catch (_error) { if (!signal.aborted) this.fail(active, operation) }
  }

  /**
   * Schedule newly available assistant sentences as playback I/O; history is never replayed.
   * @param sessionId - Session whose rendered Chat snapshot produced the values.
   * @param replies - cumulative visible text; excludes tools, reasoning, and interrupted messages.
   * @param latestTurn - current Session turn watermark.
   */
  observe(sessionId: SessionId, replies: readonly VoiceReply[], latestTurn: number): void {
    const active = this.active
    if (!active || active.sessionId !== sessionId) return
    active.latestTurn = Math.max(latestTurn, active.latestTurn)
    const signal = AbortSignal.any([active.abort.signal, active.turn.signal])
    for (const reply of replies) {
      for (const sentence of active.sentences.take(reply, !active.admitting || reply.turn <= active.afterTurn)) {
        if (active.pendingSentences >= active.maxPendingSentences) { this.fail(active, 'tooLong'); return }
        active.pendingSentences++
        active.speech = active.speech.then(async () => {
          if (signal.aborted) return
          this.update({ phase: 'speaking' })
          const playing: Promise<void>[] = []
          await this.dependencies.synthesize(sentence, signal, (audio) => {
            if (!signal.aborted) playing.push(active.audio.play(audio))
          })
          await Promise.all(playing)
          signal.throwIfAborted()
          this.update({ phase: 'listening' })
        }).catch(() => { if (!signal.aborted) this.fail(active, 'synthesis') }).finally(() => { active.pendingSentences-- })
      }
    }
  }

  private update(patch: Partial<ConversationVoiceState>): void { this.state.set({ ...this.state.getSnapshot(), ...patch }) }

  private fail(active: ActiveVoice, error: VoiceFailure): void {
    if (this.active !== active) return
    this.update({ error })
    void this.stop().catch(() => { if (!this.active) this.update({ error: 'device' }) })
  }

  /**
   * End microphone and playback without cancelling an already submitted text task.
   * @returns after Web Audio and any prior audio-release operation settle.
   */
  stop(): Promise<void> {
    const active = this.active
    this.active = undefined
    if (!active) return this.release
    active.abort.abort(); active.turn.abort(); active.reference.release()
    this.update({ phase: 'idle' })
    this.release = Promise.all([this.release, active.audio.dispose()]).then(() => undefined)
    return this.release
  }
}
