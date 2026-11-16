/** Sample-clock behavior is independent of background tabs and wall-clock scheduling. */
import { expect, it, vi } from 'vitest'
import { validateWave } from '@deepseek-ai/dsh-experimental-speech-to-text/wave'
import { TurnDetector, waveBytes } from '../src/client/audio.ts'
import type { VoiceOptions } from '../src/types.ts'

const options: VoiceOptions = { speechThreshold: 0.02, silenceMs: 300, minimumSpeechMs: 150,
  preRollMs: 200, maxUtteranceSeconds: 2, maxSentenceCharacters: 100, maxPendingSentences: 32, warmupText: '你好。' }

it('ignores silence and brief noise, retains the onset, and submits once after a speech pause', () => {
  const started = vi.fn(), finished = vi.fn<(audio: Float32Array) => void>()
  const detector = new TurnDetector(16000, options, started, finished)
  const frame = (amplitude: number, count: number) => {
    for (let index = 0; index < count; index++) detector.push(new Float32Array(800).fill(amplitude))
  }
  frame(0, 100); frame(0.3, 1); frame(0, 8)
  expect(started).not.toHaveBeenCalled(); expect(finished).not.toHaveBeenCalled()
  frame(0.3, 4)
  expect(started).toHaveBeenCalledTimes(1); expect(finished).not.toHaveBeenCalled()
  frame(0, 6)
  expect(finished).toHaveBeenCalledTimes(1)
  const captured: Float32Array = finished.mock.calls[0]![0]
  expect(captured.length).toBeGreaterThan(4 * 800)
  expect(captured.some(sample => sample > 0.29)).toBe(true)
  const wave = waveBytes(captured, 16000)
  expect(() => validateWave(wave, 3)).not.toThrow()
  frame(0, 50)
  expect(finished).toHaveBeenCalledTimes(1)
})

it('bounds an uninterrupted utterance using the sample clock', () => {
  const finished = vi.fn()
  const detector = new TurnDetector(16000, options, () => {}, finished)
  for (let index = 0; index < 40; index++) detector.push(new Float32Array(800).fill(0.3))
  expect(finished).toHaveBeenCalledTimes(1)
  expect(finished.mock.calls[0]![0]).toHaveLength(32000)
})
