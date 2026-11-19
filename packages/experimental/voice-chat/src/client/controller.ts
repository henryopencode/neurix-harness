/** Browser-owned voice conversation; ordinary Session submission owns all model-visible text. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionFace, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SpeechCatalog } from '@deepseek-ai/dsh-experimental-api-speech-to-text/types'
import type { Transcript } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { VoiceAudio, VoiceOptions, VoiceConversationPhase, VoicePreset } from '../types.ts'
import { base64Audio, LiveAudio, VoiceAudioError } from './audio.ts'
import { ReplySentences, type VoiceReply } from './replies.ts'

/** Localized failure identities; raw transport or model errors never become UI copy. */
export type VoiceFailure = 'permission' | 'device' | 'unsupported' | 'playback' | 'recognition' | 'send' | 'synthesis' | 'connection' | 'cleanup' | 'controls'
/** Transient interaction state, independent of the durable Session. */
export interface ConversationVoiceState {
  /** Session owning the active microphone or the retained transcript while idle. */
  readonly sessionId: SessionId | null
  readonly phase: VoiceConversationPhase
  readonly transcript: string
  readonly error: VoiceFailure | null
  readonly microphoneMuted: boolean
  readonly speakerMuted: boolean
  /** Monotonic within one activation; increments only for accepted voice submissions. */
  readonly sentCount: number
}

/** Host and Session callbacks captured by the Client registration. */
export interface VoiceConversationDependencies {
  readonly createAudio: () => Pick<LiveAudio, 'start' | 'play' | 'finishPlayback' | 'interrupt' | 'dispose' | 'setMicrophoneMuted' | 'setSpeakerMuted' | 'acknowledge'>
  readonly warm: (voice: VoicePreset, signal: AbortSignal) => Promise<void>
  readonly retain: (sessionId: SessionId, signal: AbortSignal) => SessionReference
  readonly catalog: () => SpeechCatalog | null
  readonly transcribe: (audioBase64: string, signal: AbortSignal) => Promise<RemoteResult<Transcript>>
  readonly synthesize: (text: string, voice: VoicePreset, signal: AbortSignal, accept: (audio: VoiceAudio) => void) => Promise<void>
}

interface ActiveVoice {
  readonly sessionId: SessionId
  readonly abort: AbortController
  readonly audio: ReturnType<VoiceConversationDependencies['createAudio']>
  readonly reference: SessionReference
  readonly sentences: ReplySentences
  readonly voice: VoicePreset
  readonly syntheses: Set<Promise<void>>
  turn: AbortController
  session?: SessionFace
  /** Steering can admit a new model request inside the same turn. */
  afterTurn: number
  afterStep: number
  latestTurn: number
  latestStep: number
  admitting: boolean
  speech: Promise<void>
  playback: Promise<void>
  capacity: Promise<void>
  warming: Promise<void>
  ready: boolean
  running: boolean
  replies: readonly VoiceReply[]
  readonly maxPendingSentences: number
  pendingSentences: number
  readonly maxSentenceCharacters: number
  queuedSegment?: { text: string; started: boolean; complete: boolean }
}

function stepAtTurn(replies: readonly VoiceReply[], turn: number): number {
  let step = 0
  for (const reply of replies) if (reply.turn === turn) step = Math.max(step, reply.step)
  return step
}

function afterPosition(turn: number, step: number, active: ActiveVoice): boolean {
  return turn > active.afterTurn || turn === active.afterTurn && step > active.afterStep
}

/** Owns one active voice conversation and releases it before another may start. */
export class VoiceConversation {
  /** Transient microphone, playback, transcript, and recovery state for the registered UI. */
  readonly state = createSnapshotStore<ConversationVoiceState>({ sessionId: null, phase: 'idle', transcript: '', error: null,
    microphoneMuted: false, speakerMuted: false, sentCount: 0 })
  /** Quantized microphone level for the orb, independent of the conversation's phase. */
  readonly inputLevel = createSnapshotStore(0)
  private active: ActiveVoice | undefined
  private release: Promise<void> = Promise.resolve()

  constructor(private readonly dependencies: VoiceConversationDependencies) {}

  /**
   * Start a user-authorized continuous microphone lifetime for one Session.
   * @param sessionId - currently displayed Session.
   * @param options - Host-owned voice limits.
   * @param replies - existing text, remembered without playback.
   * @param latestTurn - current Session turn watermark, including an unfinished turn.
   * @param latestStep - current step, including one without text; omitted uses the supplied replies.
   * @returns after capture, Session retention, and voice warmup are ready; failures remain visible in state.
   */
  async start(sessionId: SessionId, options: VoiceOptions, replies: readonly VoiceReply[], latestTurn: number,
    latestStep = stepAtTurn(replies, latestTurn)): Promise<void> {
    if (this.active) return
    const abort = new AbortController(), audio = this.dependencies.createAudio()
    const reference = this.dependencies.retain(sessionId, abort.signal)
    const active: ActiveVoice = { sessionId, abort, audio, reference, sentences: new ReplySentences(options.maxSentenceCharacters),
      voice: options.voice, syntheses: new Set(),
      turn: new AbortController(), afterTurn: latestTurn, afterStep: latestStep, latestTurn, latestStep, admitting: false,
      speech: Promise.resolve(),
      playback: Promise.resolve(), capacity: Promise.resolve(), warming: Promise.resolve(), ready: false, running: false, replies: [],
      maxPendingSentences: options.maxPendingSentences, pendingSentences: 0, maxSentenceCharacters: options.maxSentenceCharacters }
    for (const reply of replies) active.sentences.take(reply, true)
    this.active = active
    this.update({ sessionId, phase: 'requesting', transcript: '', error: null, microphoneMuted: false, speakerMuted: false, sentCount: 0 })
    try {
      await this.release
      abort.signal.throwIfAborted()
      const binding = reference.ready.then((value) => {
        if (!abort.signal.aborted) active.session = value.session
        return value
      })
      audio.setMicrophoneMuted(true)
      const capture = audio.start(options, () => { this.speechStarted(active) }, (bytes) => { void this.submit(active, bytes) },
        (error) => { this.fail(active, error.kind) }, (rms) => {
          if (this.active !== active || !active.ready || this.state.getSnapshot().microphoneMuted) return
          const level = Math.min(1, Math.max(0, (rms - 0.008) / 0.14))
          this.inputLevel.set(Math.round(level * 24) / 24)
        }).then(() => {
        if (!abort.signal.aborted) this.update({ phase: 'warming' })
      })
      active.warming = this.dependencies.warm(active.voice, abort.signal).catch((error: unknown) => {
        if (!abort.signal.aborted) this.fail(active, 'synthesis')
        throw error
      })
      await Promise.all([binding, capture, active.warming])
      abort.signal.throwIfAborted()
      active.ready = true
      audio.setMicrophoneMuted(this.state.getSnapshot().microphoneMuted)
      this.update({ phase: 'listening' })
    } catch (error) { if (!abort.signal.aborted) this.fail(active, error instanceof VoiceAudioError ? error.kind : 'device') }
  }

  private speechStarted(active: ActiveVoice): void {
    if (this.active !== active || !active.ready) return
    active.turn.abort(); active.audio.interrupt(); active.turn = new AbortController()
    active.speech = Promise.resolve(); active.playback = Promise.resolve(); active.capacity = Promise.resolve()
    active.pendingSentences = 0
    delete active.queuedSegment
    active.afterTurn = active.latestTurn; active.afterStep = active.latestStep; active.admitting = false
    this.update({ phase: 'recording', error: null })
  }

  private async submit(active: ActiveVoice, bytes: Uint8Array): Promise<void> {
    if (this.active !== active || !active.ready) return
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
      const session = active.session
      if (!session) throw new Error('Voice Session is not ready')
      active.afterTurn = active.latestTurn; active.afterStep = active.latestStep
      active.admitting = true
      this.update({ phase: 'thinking' })
      const mode = session.getSnapshot().running ? 'steer' : 'queue'
      const submission = session.beginSubmission({ mode, text, attachments: [] })
      const sent = await session.prompt([{ type: 'text', text }], mode, signal, submission.requestId)
      signal.throwIfAborted()
      if (!sent.ok) throw sent.error
      this.update({ sentCount: this.state.getSnapshot().sentCount + 1 })
      active.audio.acknowledge()
    } catch (_error) { if (!signal.aborted) this.fail(active, operation) }
  }

  /**
   * Schedule newly available assistant sentences as playback I/O; history is never replayed.
   * @param sessionId - Session whose rendered Chat snapshot produced the values.
   * @param replies - cumulative visible text; excludes tools, reasoning, and interrupted messages.
   * @param latestTurn - current Session turn watermark.
   * @param running - whether the Session is still preparing or streaming its reply; omitted treats it as settled.
   * @param latestStep - current step, including one without text; omitted uses the supplied replies.
   */
  observe(sessionId: SessionId, replies: readonly VoiceReply[], latestTurn: number, running = false,
    latestStep = stepAtTurn(replies, latestTurn)): void {
    const active = this.active
    if (!active || active.sessionId !== sessionId) return
    if (latestTurn > active.latestTurn) { active.latestTurn = latestTurn; active.latestStep = latestStep }
    else if (latestTurn === active.latestTurn) active.latestStep = Math.max(latestStep, active.latestStep)
    active.running = running
    active.replies = replies
    const currentPhase = this.state.getSnapshot().phase
    if (active.ready && currentPhase !== 'recording' && currentPhase !== 'transcribing'
      && afterPosition(active.latestTurn, active.latestStep, active)) active.admitting = true
    const signal = AbortSignal.any([active.abort.signal, active.turn.signal])
    for (const reply of replies) {
      for (const sentence of active.sentences.take(reply, !active.admitting || !afterPosition(reply.turn, reply.step, active),
        active.maxPendingSentences - active.pendingSentences)) {
        const queued = active.queuedSegment, separator = queued && /[。！？；]$/.test(queued.text) ? '' : ' '
        if (queued && !queued.started && queued.text.length + separator.length + sentence.length <= active.maxSentenceCharacters) {
          queued.text += separator + sentence
          continue
        }
        const segment = { text: sentence, started: false, complete: false }
        active.queuedSegment = segment
        active.pendingSentences++
        const capacity = active.capacity, previousPlayback = active.playback
        const drained = Promise.withResolvers<void>()
        const cancelled = (): void => { drained.resolve() }
        signal.addEventListener('abort', cancelled, { once: true })
        void drained.promise.then(() => { signal.removeEventListener('abort', cancelled) })
        active.capacity = previousPlayback
        active.playback = drained.promise
        active.speech = active.speech.then(async () => {
          if (signal.aborted) return
          await capacity
          signal.throwIfAborted()
          segment.started = true
          if (this.state.getSnapshot().phase === 'listening') this.update({ phase: 'thinking' })
          const playing: Promise<void>[] = []
          await this.dependencies.synthesize(segment.text, active.voice, signal, (audio) => {
            if (!signal.aborted) {
              const playback = active.audio.play(audio, signal, () => {
                if (this.state.getSnapshot().phase !== 'speaking') this.update({ phase: 'speaking' })
              })
              void playback.catch(() => { if (!signal.aborted) this.fail(active, 'playback') })
              playing.push(playback)
            }
          })
          signal.throwIfAborted()
          segment.complete = true
          if (!active.running && active.queuedSegment === segment) active.audio.finishPlayback()
          void Promise.all(playing).then(() => {
            if (!signal.aborted) {
              active.pendingSentences--
              if (active.pendingSentences === 0) this.update({ phase: active.running ? 'thinking' : 'listening' })
              this.observe(active.sessionId, active.replies, active.latestTurn, active.running, active.latestStep)
            }
          }).catch(() => { if (!signal.aborted) this.fail(active, 'playback') }).finally(() => { drained.resolve() })
        }).catch(() => {
          drained.resolve()
          if (!signal.aborted) this.fail(active, 'synthesis')
        }).then(() => { if (signal.aborted) drained.resolve() })
        const task = active.speech
        active.syntheses.add(task)
        void task.finally(() => { active.syntheses.delete(task) })
      }
    }
    const phase = this.state.getSnapshot().phase
    if (active.ready && active.pendingSentences === 0 && (phase === 'listening' || phase === 'thinking')) {
      const next = running && active.admitting ? 'thinking' : 'listening'
      if (phase !== next) this.update({ phase: next })
    }
    if (!running && active.queuedSegment?.complete) active.audio.finishPlayback()
  }

  private update(patch: Partial<ConversationVoiceState>): void { this.state.set({ ...this.state.getSnapshot(), ...patch }) }

  private fail(active: ActiveVoice, error: VoiceFailure): void {
    if (this.active !== active) return
    this.update({ error })
    void this.stop().catch(() => { if (!this.active) this.update({ error: 'cleanup' }) })
  }

  /**
   * End microphone and playback without cancelling an already submitted text task.
   * @param feedback - use an audible close cue for an explicit user action.
   * @returns after Web Audio, cancelled synthesis, and prior audio release settle,
   * and the Session reference is released.
   */
  stop(feedback = false): Promise<void> {
    const active = this.active
    this.active = undefined
    if (!active) return this.release
    active.abort.abort(); active.turn.abort()
    this.update({ phase: 'stopping' })
    this.inputLevel.set(0)
    this.release = Promise.all([
      this.release, active.audio.dispose(feedback), Promise.allSettled([active.warming, ...active.syntheses]),
    ]).then(() => {
      active.reference.release()
      if (!this.active) this.update({ phase: 'idle' })
    }, (error: unknown) => {
      active.reference.release()
      if (!this.active) this.update({ error: 'cleanup' })
      throw error
    })
    return this.release
  }

  /** Toggle input capture without ending the retained conversation or replaying a partial utterance. */
  toggleMicrophone(): void {
    const active = this.active
    if (!active) return
    const muted = !this.state.getSnapshot().microphoneMuted
    active.audio.setMicrophoneMuted(muted || !active.ready)
    if (muted) this.inputLevel.set(0)
    this.update({ microphoneMuted: muted,
      ...muted && this.state.getSnapshot().phase === 'recording' ? { phase: 'listening' } : {} })
  }

  /** Toggle audible playback while retaining the written reply and synthesis ordering. */
  toggleSpeaker(): void {
    const active = this.active
    if (!active) return
    const muted = !this.state.getSnapshot().speakerMuted
    active.audio.setSpeakerMuted(muted)
    this.update({ speakerMuted: muted })
  }
}
