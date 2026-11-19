/** Continuous browser capture, silence-based turn detection, and interruptible PCM playback. */
import type { VoiceAudio, VoiceOptions } from '../types.ts'

/** Microphone or audio-output failure rendered through the voice dictionary. */
export class VoiceAudioError extends Error {
  constructor(readonly kind: 'permission' | 'device' | 'unsupported' | 'playback') { super(kind) }
}

/**
 * Encode an utterance as mono PCM16 WAV for the existing recognizer.
 * @param samples - mono audio at the supplied rate.
 * @param sampleRate - browser AudioContext rate.
 * @returns a complete WAV recording accepted by the speech Remote.
 */
export function waveBytes(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(44 + samples.length * 2), view = new DataView(output.buffer)
  const ascii = (value: string, offset: number): void => { output.set(new TextEncoder().encode(value), offset) }
  ascii('RIFF', 0); ascii('WAVEfmt ', 8); ascii('data', 36)
  view.setUint32(4, output.length - 8, true); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, index) => { view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true) })
  return output
}

/**
 * Encode bounded audio bytes for the JSON Remote transport.
 * @param data - one WAV recording.
 * @returns canonical base64 without a data-URL prefix.
 */
export function base64Audio(data: Uint8Array): string {
  const chunks: string[] = []
  for (let offset = 0; offset < data.length; offset += 4096) chunks.push(String.fromCharCode(...data.subarray(offset, offset + 4096)))
  return btoa(chunks.join(''))
}

/** Deterministic sample-clock turn detector with bounded onset padding. */
export class TurnDetector {
  private preceding: Float32Array[] = []
  private utterance: Float32Array[] = []
  private retainedSamples = 0
  private elapsedMs = 0
  private lastSpeechMs = 0
  private voicedMs = 0
  private confirmed = false

  constructor(private readonly rate: number, private readonly options: VoiceOptions,
    private readonly speechStarted: () => void, private readonly finished: (samples: Float32Array) => void) {}

  /** Discard an unfinished utterance when input is muted. */
  reset(): void {
    this.preceding = []; this.utterance = []; this.retainedSamples = 0
    this.elapsedMs = 0; this.lastSpeechMs = 0; this.voicedMs = 0; this.confirmed = false
  }

  /**
   * Admit one ordered microphone frame; silence never creates a turn.
   * @param samples - owned mono frame at the detector's sample rate.
   */
  push(samples: Float32Array): void {
    let energy = 0
    for (const value of samples) energy += value * value
    const voiced = Math.sqrt(energy / samples.length) >= this.options.speechThreshold
    const duration = samples.length / this.rate * 1000
    if (this.utterance.length === 0) {
      this.preceding.push(samples); this.retainedSamples += samples.length
      const limit = this.rate * this.options.preRollMs / 1000
      while (this.preceding.length > 1 && this.retainedSamples > limit) {
        const dropped = this.preceding.shift()
        if (dropped) this.retainedSamples -= dropped.length
      }
      if (!voiced) return
      this.utterance = this.preceding; this.preceding = []; this.retainedSamples = 0
    } else this.utterance.push(samples)
    this.elapsedMs += duration
    if (voiced) { this.lastSpeechMs = this.elapsedMs; this.voicedMs += duration }
    if (!this.confirmed && this.voicedMs >= this.options.minimumSpeechMs) { this.confirmed = true; this.speechStarted() }
    if (this.elapsedMs - this.lastSpeechMs < this.options.silenceMs && this.elapsedMs < this.options.maxUtteranceSeconds * 1000) return
    const frames = this.utterance, confirmed = this.confirmed
    this.utterance = []; this.elapsedMs = 0; this.lastSpeechMs = 0; this.voicedMs = 0; this.confirmed = false
    if (!confirmed) return
    const combined = new Float32Array(Math.min(frames.reduce((length, frame) => length + frame.length, 0),
      Math.floor(this.rate * this.options.maxUtteranceSeconds)))
    let offset = 0
    for (const frame of frames) {
      const remaining = combined.length - offset
      if (remaining === 0) break
      const admitted = frame.subarray(0, remaining)
      combined.set(admitted, offset); offset += admitted.length
    }
    this.finished(combined)
  }
}

const captureProcessor = `class VoiceCapture extends AudioWorkletProcessor {
  constructor() { super(); this.frame = new Float32Array(1024); this.offset = 0; }
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    if (input) for (const sample of input) {
      this.frame[this.offset++] = sample;
      if (this.offset === this.frame.length) {
        this.port.postMessage(this.frame, [this.frame.buffer]);
        this.frame = new Float32Array(1024); this.offset = 0;
      }
    }
    for (const channel of outputs[0] ?? []) channel.fill(0);
    return true;
  }
}
registerProcessor('neurix-voice-capture', VoiceCapture);`

interface BufferedAudio {
  readonly duration: number
  readonly schedule: () => void
  readonly cancel: () => void
}

/** One user-started microphone and playback lifetime, including late permission grants. */
export class LiveAudio {
  private readonly lifetime = new AbortController()
  private context: AudioContext | undefined
  private stream: MediaStream | undefined
  private capture: AudioWorkletNode | undefined
  private readonly buffered = new Set<BufferedAudio>()
  private readonly playing = new Set<() => void>()
  private buffering: ReturnType<typeof setTimeout> | undefined
  private playbackStarted = false
  private playbackUntil = 0
  private closing: Promise<void> | undefined
  private detector: TurnDetector | undefined
  private playback: GainNode | undefined
  private inputMuted = false
  private outputMuted = false
  private playbackBufferSeconds = 0
  private playbackResumeTimeoutMs = 0

  constructor(private readonly inputDeviceId = '') {}

  /**
   * Start echo-cancelled continuous capture and unlock browser audio in the user gesture.
   * @param options - validated detection limits.
   * @param speechStarted - confirmed speech onset, used to interrupt the current reply.
   * @param utterance - completed PCM16 WAV after a silence interval.
   * @param failed - interrupted device or audio failure; the owner stops the conversation.
   * @returns after microphone and AudioWorklet are ready.
   */
  async start(options: VoiceOptions, speechStarted: () => void, utterance: (audio: Uint8Array) => void,
    failed: (error: VoiceAudioError) => void): Promise<void> {
    const devices = (navigator as Partial<Navigator>).mediaDevices
    if (!devices || typeof AudioWorkletNode === 'undefined') throw new VoiceAudioError('unsupported')
    this.playbackBufferSeconds = options.playbackBufferMs / 1000
    this.playbackResumeTimeoutMs = options.playbackResumeTimeoutMs
    this.context = new AudioContext({ sampleRate: 16000 })
    const context = this.context
    await context.resume()
    this.playback = context.createGain()
    this.playback.gain.value = this.outputMuted ? 0 : 1
    this.playback.connect(context.destination)
    try {
      const stream = await devices.getUserMedia({ audio: {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
        ...this.inputDeviceId === '' ? {} : { deviceId: { exact: this.inputDeviceId } },
      }, video: false })
      if (this.lifetime.signal.aborted) { for (const track of stream.getTracks()) track.stop(); this.lifetime.signal.throwIfAborted() }
      this.stream = stream
      for (const track of stream.getAudioTracks()) track.enabled = !this.inputMuted
      for (const track of stream.getTracks()) track.addEventListener('ended', () => { failed(new VoiceAudioError('device')) }, { signal: this.lifetime.signal })
      const url = URL.createObjectURL(new Blob([captureProcessor], { type: 'text/javascript' }))
      try { await context.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
      this.lifetime.signal.throwIfAborted()
      const detector = new TurnDetector(context.sampleRate, options, speechStarted, (samples) => {
        if (context.sampleRate === 16000) { utterance(waveBytes(samples, 16000)); return }
        void this.resample(samples, context.sampleRate).then((audio) => {
          if (!this.lifetime.signal.aborted) utterance(audio)
        }).catch(() => { if (!this.lifetime.signal.aborted) failed(new VoiceAudioError('device')) })
      })
      this.detector = detector
      this.capture = new AudioWorkletNode(context, 'neurix-voice-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
      this.capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!this.lifetime.signal.aborted && !this.inputMuted) detector.push(event.data)
      }
      this.capture.onprocessorerror = () => { failed(new VoiceAudioError('device')) }
      context.createMediaStreamSource(stream).connect(this.capture)
      this.capture.connect(context.destination)
    } catch (error) {
      await this.dispose()
      if (error instanceof DOMException && error.name === 'NotAllowedError') throw new VoiceAudioError('permission')
      throw error
    }
  }

  private async resample(samples: Float32Array, rate: number): Promise<Uint8Array> {
    const context = new OfflineAudioContext(1, Math.ceil(samples.length / rate * 16000), 16000)
    const buffer = context.createBuffer(1, samples.length, rate)
    buffer.copyToChannel(Float32Array.from(samples), 0)
    const source = context.createBufferSource()
    source.buffer = buffer; source.connect(context.destination); source.start()
    return waveBytes((await context.startRendering()).getChannelData(0), 16000)
  }

  /**
   * Buffer or schedule a streamed PCM fragment in order. Only the start of a
   * reply accumulates lead; an underrun resumes as soon as audio arrives.
   * @param audio - decoded Remote audio fragment.
   * @param signal - owning reply lifetime; cancellation prevents late output resumption and stops queued audio.
   * @param started - notified when this fragment is handed to Web Audio.
   * @returns after playback or cancellation; rejects if output cannot resume within the configured deadline.
   */
  async play(audio: VoiceAudio, signal: AbortSignal, started?: () => void): Promise<void> {
    const context = this.context
    const lifetime = AbortSignal.any([this.lifetime.signal, signal])
    const isCancelled = (): boolean => lifetime.aborted
    if (!context || isCancelled()) return
    if (context.state !== 'running') {
      try { await this.resumeOutput(context, lifetime) }
      catch (_error) {
        if (isCancelled()) return
        throw new VoiceAudioError('playback')
      }
    }
    if (isCancelled()) return
    const bytes = Uint8Array.from(atob(audio.pcmBase64), character => character.charCodeAt(0))
    if (bytes.length % 2 !== 0 || bytes.length === 0 || audio.sampleRate !== 24000) throw new VoiceAudioError('playback')
    const view = new DataView(bytes.buffer), buffer = context.createBuffer(1, bytes.length / 2, audio.sampleRate)
    const samples = buffer.getChannelData(0)
    for (let index = 0; index < samples.length; index++) samples[index] = view.getInt16(index * 2, true) / 32768
    const done = Promise.withResolvers<void>()
    let source: AudioBufferSourceNode | undefined
    const detach = (): void => {
      lifetime.removeEventListener('abort', cancel)
      this.buffered.delete(fragment); this.playing.delete(cancel)
      if (source) { source.onended = null; source.disconnect() }
      if (this.buffered.size === 0) this.clearBuffering()
    }
    const cancel = (): void => {
      if (source) { source.onended = null; source.stop() }
      detach(); done.resolve()
    }
    const fragment: BufferedAudio = { duration: buffer.duration, cancel, schedule: () => {
      this.buffered.delete(fragment)
      if (isCancelled()) { cancel(); return }
      try {
        const node = source = context.createBufferSource()
        node.buffer = buffer; node.connect(this.playback ?? context.destination)
        const start = Math.max(this.playbackUntil, context.currentTime)
        node.start(start)
        this.playbackUntil = start + buffer.duration
        this.playing.add(cancel)
        node.onended = () => { detach(); done.resolve() }
        started?.()
      } catch (_error) {
        if (source && this.playing.has(cancel)) { source.onended = null; source.stop() }
        detach(); done.reject(new VoiceAudioError('playback'))
      }
    } }
    lifetime.addEventListener('abort', cancel, { once: true })
    if (this.playbackStarted) fragment.schedule()
    else {
      this.buffered.add(fragment)
      const duration = [...this.buffered].reduce((sum, item) => sum + item.duration, 0)
      if (duration >= this.playbackBufferSeconds) this.startBuffered()
      else this.buffering ??= setTimeout(() => { this.startBuffered() }, this.playbackBufferSeconds * 1000)
    }
    return done.promise
  }

  private clearBuffering(): void {
    clearTimeout(this.buffering); this.buffering = undefined
  }

  private startBuffered(): void {
    this.clearBuffering()
    if (this.buffered.size === 0) return
    this.playbackStarted = true
    for (const fragment of this.buffered) fragment.schedule()
  }

  /** Start a completed short reply, or reset the lead after the completed reply drains. */
  finishPlayback(): void {
    if (this.buffered.size > 0) this.startBuffered()
    else if (this.playing.size === 0) this.playbackStarted = false
  }

  private async resumeOutput(context: AudioContext, signal: AbortSignal): Promise<void> {
    const ready = Promise.withResolvers<void>()
    const isCancelled = (): boolean => signal.aborted
    const cancelled = (): void => { ready.resolve() }
    const timer = setTimeout(() => { ready.reject(new VoiceAudioError('playback')) }, this.playbackResumeTimeoutMs)
    signal.addEventListener('abort', cancelled, { once: true })
    try {
      if (isCancelled()) return
      void context.resume().then(() => { ready.resolve() }, ready.reject)
      await ready.promise
      if (!isCancelled() && context.state !== 'running') throw new VoiceAudioError('playback')
    } finally { clearTimeout(timer); signal.removeEventListener('abort', cancelled) }
  }

  /** Stop audible and queued fragments immediately; capture remains active for the next utterance. */
  interrupt(): void {
    for (const fragment of this.buffered) fragment.cancel()
    for (const cancel of this.playing) cancel()
    this.playbackUntil = 0; this.playbackStarted = false
  }

  /** Suppress microphone frames and discard an unfinished utterance.
   * @param muted - whether input should remain muted.
   */
  setMicrophoneMuted(muted: boolean): void {
    this.inputMuted = muted
    if (muted) this.detector?.reset()
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = !muted
  }

  /** Mute current and queued playback without discarding the written response.
   * @param muted - whether output should remain inaudible.
   */
  setSpeakerMuted(muted: boolean): void {
    this.outputMuted = muted
    if (this.playback) this.playback.gain.value = muted ? 0 : 1
  }

  /**
   * Invalidate permission grants, stop all tracks and playback, and close Web Audio.
   * @returns the shared, joined release promise.
   */
  dispose(): Promise<void> {
    if (this.closing) return this.closing
    this.lifetime.abort(); this.interrupt()
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.capture?.port.close(); this.capture?.disconnect()
    this.playback?.disconnect(); this.detector?.reset()
    const context = this.context
    this.context = undefined
    this.closing = context && context.state !== 'closed' ? context.close() : Promise.resolve()
    return this.closing
  }
}
