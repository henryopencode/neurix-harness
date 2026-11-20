/** Web Audio scheduling holds a small lead while preserving ordered, interruptible playback. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { LiveAudio } from '../src/client/audio.ts'
import type { VoiceOptions } from '../src/types.ts'

const options: VoiceOptions = { speechThreshold: 0.02, silenceMs: 300, minimumSpeechMs: 150,
  preRollMs: 200, maxUtteranceSeconds: 2, maxPendingUtterances: 4, maxSentenceCharacters: 100, maxPendingSentences: 32,
  warmupText: '', voice: 'natural', playbackBufferMs: 320, playbackResumeTimeoutMs: 5000 }

function browserAudio() {
  class Source {
    buffer: { duration: number } | null = null
    onended: (() => void) | null = null
    start = vi.fn()
    stop = vi.fn(() => { this.onended?.() })
    connect = vi.fn()
    disconnect = vi.fn()
  }
  class Oscillator {
    frequency = { value: 0 }
    onended: (() => void) | null = null
    start = vi.fn()
    stop = vi.fn()
    connect = <Node>(node: Node): Node => node
    disconnect = vi.fn()
  }
  const sources: Source[] = [], tones: Oscillator[] = [], track = new EventTarget()
  const stopTrack = vi.fn()
  Object.assign(track, { enabled: true, stop: stopTrack })
  const capture = { port: { close: vi.fn(), onmessage: null }, connect: vi.fn(), disconnect: vi.fn() }
  class Audio {
    sampleRate = 16000
    currentTime = 4
    state = 'running'
    destination = {}
    audioWorklet = { addModule: async () => {} }
    resume = vi.fn(async () => { this.state = 'running' })
    close = vi.fn(async () => {})
    createGain = () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() })
    createMediaStreamSource = () => ({ connect: vi.fn() })
    createBuffer = (_channels: number, length: number, rate: number) => ({
      duration: length / rate, getChannelData: () => new Float32Array(length),
    })
    createBufferSource = () => { const source = new Source(); sources.push(source); return source }
    createOscillator = () => { const tone = new Oscillator(); tones.push(tone); return tone }
  }
  const context = new Audio()
  vi.stubGlobal('AudioContext', vi.fn(function () { return context }))
  vi.stubGlobal('GainNode', class {
    gain = { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }
    connect = vi.fn()
    disconnect = vi.fn()
  })
  vi.stubGlobal('AudioWorkletNode', vi.fn(function () { return capture }))
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:voice-test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const audio = new LiveAudio()
  onTestFinished(async () => { try { await audio.dispose() } finally { vi.restoreAllMocks(); vi.unstubAllGlobals() } })
  return { audio, context, sources, tones, stopTrack }
}

it('plays distinct open, accepted, and close sounds, releasing capture before the closing sound drains', async () => {
  const b = browserAudio()
  await b.audio.start(options, () => {}, () => {}, () => {})
  expect(b.tones).toHaveLength(0)
  b.audio.announceReady()
  expect(b.tones).toHaveLength(2)
  b.audio.setSpeakerMuted(true); b.audio.acknowledge()
  expect(b.tones).toHaveLength(2)
  b.audio.setSpeakerMuted(false); b.audio.acknowledge()
  vi.useFakeTimers()
  const closing = b.audio.dispose(true)
  try {
    expect(b.stopTrack).toHaveBeenCalledOnce()
    expect(b.context.close).not.toHaveBeenCalled()
    const pitches = b.tones.map(tone => tone.frequency.value)
    expect(pitches).toHaveLength(6)
    expect(new Set(pitches).size).toBe(6)
    expect(pitches[0]).toBeLessThan(pitches[1]!)
    expect(pitches[4]).toBeGreaterThan(pitches[5]!)
  } finally {
    try { await vi.runOnlyPendingTimersAsync() } finally { vi.useRealTimers() }
    await closing
  }
  expect(b.context.close).toHaveBeenCalledOnce()
})

it('collects reply lead and does not add latency again after an underrun', async () => {
  const b = browserAudio()
  await b.audio.start({ ...options, playbackBufferMs: 200 }, () => {}, () => {}, () => {})
  const fragment = { pcmBase64: btoa('\0'.repeat(4800)), sampleRate: 24000 }
  const first = b.audio.play(fragment, new AbortController().signal)
  expect(b.sources).toHaveLength(0)
  b.context.currentTime = 4.12
  const second = b.audio.play(fragment, new AbortController().signal)
  expect(b.sources[0]!.start).toHaveBeenCalledWith(4.12)
  expect(b.sources[1]!.start).toHaveBeenCalledWith(4.22)
  b.sources[0]!.onended?.(); b.sources[1]!.onended?.()
  await Promise.all([first, second])
  b.context.currentTime = 10
  const resumed = b.audio.play(fragment, new AbortController().signal)
  expect(b.sources[2]!.start).toHaveBeenCalledWith(10)
  b.audio.interrupt(); await resumed
  expect(b.sources[2]!.stop).toHaveBeenCalledOnce()
  await b.audio.dispose()
  expect(b.stopTrack).toHaveBeenCalledOnce()
})

it('starts a complete short reply and drops a cancelled buffer before it reaches Web Audio', async () => {
  const b = browserAudio(), turn = new AbortController()
  await b.audio.start(options, () => {}, () => {}, () => {})
  const fragment = { pcmBase64: btoa('\0'.repeat(4800)), sampleRate: 24000 }
  const discarded = b.audio.play(fragment, turn.signal)
  turn.abort(); await discarded
  expect(b.sources).toHaveLength(0)
  b.audio.finishPlayback()
  const short = b.audio.play(fragment, new AbortController().signal)
  expect(b.sources).toHaveLength(0)
  b.audio.finishPlayback()
  expect(b.sources[0]?.start).toHaveBeenCalledWith(4)
  b.sources[0]!.onended?.(); await short
})

it('resumes suspended output before scheduling a spoken reply', async () => {
  const b = browserAudio()
  await b.audio.start({ ...options, playbackBufferMs: 0 }, () => {}, () => {}, () => {})
  b.context.state = 'suspended'
  const played = b.audio.play({ pcmBase64: btoa('\0'.repeat(4800)), sampleRate: 24000 }, new AbortController().signal)
  await vi.waitFor(() => { expect(b.sources).toHaveLength(1) })
  expect(b.context.resume).toHaveBeenCalledTimes(2)
  expect(b.context.state).toBe('running')
  b.sources[0]!.onended?.(); await played
})

it('reports a rejected audio resume instead of silently scheduling inaudible speech', async () => {
  const b = browserAudio()
  await b.audio.start(options, () => {}, () => {}, () => {})
  b.context.state = 'suspended'
  b.context.resume.mockRejectedValueOnce(new Error('Output is unavailable'))
  await expect(b.audio.play({ pcmBase64: btoa('\0'.repeat(4800)), sampleRate: 24000 }, new AbortController().signal))
    .rejects.toMatchObject({ kind: 'playback' })
  expect(b.sources).toHaveLength(0)
})

it('invalidates pending output resume when a reply is interrupted', async () => {
  const b = browserAudio(), resumed = Promise.withResolvers<undefined>(), turn = new AbortController()
  await b.audio.start(options, () => {}, () => {}, () => {})
  b.context.state = 'suspended'
  b.context.resume.mockImplementationOnce(async () => { await resumed.promise; b.context.state = 'running' })
  const played = b.audio.play({ pcmBase64: btoa('\0'.repeat(4800)), sampleRate: 24000 }, turn.signal)
  turn.abort(); await played
  resumed.resolve(undefined)
  expect(b.sources).toHaveLength(0)
})

it('bounds output resumption when the browser never unlocks audio', async () => {
  const b = browserAudio(), resumed = Promise.withResolvers<undefined>()
  await b.audio.start({ ...options, playbackResumeTimeoutMs: 25 }, () => {}, () => {}, () => {})
  b.context.state = 'suspended'
  b.context.resume.mockImplementationOnce(async () => { await resumed.promise })
  vi.useFakeTimers()
  onTestFinished(() => { vi.useRealTimers() })
  const played = b.audio.play({ pcmBase64: btoa('\0'.repeat(4800)), sampleRate: 24000 }, new AbortController().signal)
  const failed = expect(played).rejects.toMatchObject({ kind: 'playback' })
  await vi.advanceTimersByTimeAsync(26)
  await failed
  expect(b.sources).toHaveLength(0)
  resumed.resolve(undefined)
})
