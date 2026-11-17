/** Web Audio scheduling holds a small lead while preserving ordered, interruptible playback. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { LiveAudio } from '../src/client/audio.ts'
import type { VoiceOptions } from '../src/types.ts'

const options: VoiceOptions = { speechThreshold: 0.02, silenceMs: 300, minimumSpeechMs: 150,
  preRollMs: 200, maxUtteranceSeconds: 2, maxSentenceCharacters: 100, maxPendingSentences: 32,
  warmupText: '', voice: 'natural', playbackBufferMs: 320 }

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
    resume = async () => {}
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
  const first = b.audio.play(fragment)
  b.context.currentTime = 4.12
  const second = b.audio.play(fragment)
  expect(b.sources[0]!.start).toHaveBeenCalledWith(4.32)
  expect(b.sources[1]!.start).toHaveBeenCalledWith(4.42)
  b.sources[0]!.onended?.(); b.sources[1]!.onended?.()
  await Promise.all([first, second])
  b.context.currentTime = 10
  const resumed = b.audio.play(fragment)
  expect(b.sources[2]!.start).toHaveBeenCalledWith(10.32)
  b.audio.interrupt(); await resumed
  expect(b.sources[2]!.stop).toHaveBeenCalledOnce()
  await b.audio.dispose()
  expect(b.stopTrack).toHaveBeenCalledOnce()
})
