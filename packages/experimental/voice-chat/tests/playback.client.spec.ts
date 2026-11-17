/** Web Audio scheduling holds a small lead while preserving ordered, interruptible playback. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { LiveAudio } from '../src/client/audio.ts'
import type { VoiceOptions } from '../src/types.ts'

const options: VoiceOptions = { speechThreshold: 0.02, silenceMs: 300, minimumSpeechMs: 150,
  preRollMs: 200, maxUtteranceSeconds: 2, maxSentenceCharacters: 100, maxPendingSentences: 32,
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
  const sources: Source[] = [], track = new EventTarget()
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
  }
  const context = new Audio()
  vi.stubGlobal('AudioContext', vi.fn(function () { return context }))
  vi.stubGlobal('AudioWorkletNode', vi.fn(function () { return capture }))
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:voice-test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const audio = new LiveAudio()
  onTestFinished(async () => { try { await audio.dispose() } finally { vi.restoreAllMocks(); vi.unstubAllGlobals() } })
  return { audio, context, sources, stopTrack }
}

it('starts with a bounded buffer and schedules arriving fragments without inter-fragment gaps', async () => {
  const b = browserAudio()
  await b.audio.start(options, () => {}, () => {}, () => {})
  const fragment = { pcmBase64: btoa('\0'.repeat(4800)), sampleRate: 24000 }
  const first = b.audio.play(fragment, new AbortController().signal)
  b.context.currentTime = 4.12
  const second = b.audio.play(fragment, new AbortController().signal)
  expect(b.sources[0]!.start).toHaveBeenCalledWith(4.32)
  expect(b.sources[1]!.start).toHaveBeenCalledWith(4.42)
  b.sources[0]!.onended?.(); b.sources[1]!.onended?.()
  await Promise.all([first, second])
  b.context.currentTime = 10
  const resumed = b.audio.play(fragment, new AbortController().signal)
  expect(b.sources[2]!.start).toHaveBeenCalledWith(10.32)
  b.audio.interrupt(); await resumed
  expect(b.sources[2]!.stop).toHaveBeenCalledOnce()
  await b.audio.dispose()
  expect(b.stopTrack).toHaveBeenCalledOnce()
})

it('resumes suspended output before scheduling a spoken reply', async () => {
  const b = browserAudio()
  await b.audio.start(options, () => {}, () => {}, () => {})
  b.context.state = 'suspended'
  const played = b.audio.play({ pcmBase64: btoa('\0'.repeat(4800)), sampleRate: 24000 }, new AbortController().signal)
  await vi.waitFor(() => { expect(b.context.resume).toHaveBeenCalledTimes(2) })
  expect(b.context.state).toBe('running')
  await vi.waitFor(() => { expect(b.sources).toHaveLength(1) })
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
