/** One content-free display state drives desktop windows and their previews. */

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Config } from '../src/index.ts'
import { characterLabel, IndependentFeedback, keyLabel } from '../src/feedback.ts'

const marker = vi.hoisted(() => ({ move: vi.fn(), feedback: vi.fn(), close: vi.fn(), select: vi.fn(), drag: vi.fn() }))
vi.mock('../src/overlay.ts', () => ({ MacOverlay: class {
  move = marker.move; feedback = marker.feedback; close = marker.close; select = marker.select
  drag = marker.drag
} }))
const signal = new AbortController().signal
const window = { x: 1512, y: -98, width: 1200, height: 980 }
const content = { x: 1512, y: 0, width: 1200, height: 882 }
let feedback: IndependentFeedback
beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  feedback = new IndependentFeedback(Config({ inputMode: 'background', cursorMoveDurationMs: 450 }))
})
afterEach(async () => { await feedback.close(); vi.useRealTimers() })

it.each(['a', 'A', 'ß', 'é', '👩🏽‍💻'])('preserves the exact delivered grapheme %s while shortcut names use key labels', (character) => {
  expect(characterLabel(character)).toBe(character)
  expect(keyLabel(['Meta', 'a'])).toBe('⌘  A')
})

it.each([['\n', '↵'], ['\r\n', '↵'], ['\t', '⇥'], [' ', '␣']] as const)('shows visible whitespace for %j', (character, expected) => {
  expect(characterLabel(character)).toBe(expected)
})

it('uses the same screen point for the native marker and content-relative preview across displays', async () => {
  feedback.select('tab-1', 7, window, content)
  await feedback.update({ x: 1812, y: 220.5, durationMs: 0, idleMs: 1600 }, signal)
  expect(marker.move).toHaveBeenCalledWith({ x: 1812, y: 220.5 }, 0, 1600, expect.any(AbortSignal), true, 7, window)
  expect(feedback.preview('tab-1')).toMatchObject({ cursor: { x: .25, y: .25 }, active: true })
  await feedback.update({ x: 2412, y: 661.5, durationMs: 450, idleMs: 1600 }, signal)
  vi.setSystemTime(Date.now() + 225)
  expect(feedback.preview('tab-1')).toMatchObject({ cursor: { x: .5, y: .5 } })
})

it('shares held input and the latest delivered key without retaining the complete document text', async () => {
  feedback.select('window-1', 7, window)
  await feedback.update({ x: 1600, y: 50, idleMs: 1600 }, signal)
  await feedback.update({ pressed: true, idleMs: 1600 }, signal)
  await feedback.update({ x: 1700, y: 100, idleMs: 1600 }, signal)
  expect(feedback.preview('window-1').cursor?.pressed).toBe(true)
  await feedback.update({ pressed: false, click: true, idleMs: 1600 }, signal)
  expect(marker.feedback).toHaveBeenLastCalledWith({ click: true }, 1600, expect.any(AbortSignal))
  expect(feedback.preview('window-1').cursor?.clickAt).toBeTypeOf('number')
  await feedback.update({ typing: true, hold: true, idleMs: 1600 }, signal)
  expect(feedback.preview('window-1').keyboard).toEqual({ kind: 'typing' })
  await feedback.update({ typing: true, key: '真', hold: true, idleMs: 1600 }, signal)
  expect(marker.feedback).toHaveBeenLastCalledWith({ typing: true, key: '真', hold: true }, 1600, expect.any(AbortSignal))
  await feedback.update({ typing: true, key: '实', hold: true, idleMs: 1600 }, signal)
  expect(feedback.preview('window-1').keyboard).toEqual({ kind: 'typing', key: '实' })
  vi.setSystemTime(Date.now() + 10_000)
  expect(feedback.preview('window-1').active).toBe(true)
  await feedback.update({ typing: true, hold: false, idleMs: 1600 }, signal)
  expect(feedback.preview('window-1').keyboard).toEqual({ kind: 'typing', key: '实' })
  await feedback.update({ keys: ['Meta', 'A'], idleMs: 1600 }, signal)
  expect(feedback.preview('window-1').keyboard).toEqual({ kind: 'shortcut', keys: ['⌘', 'A'] })
  vi.setSystemTime(Date.now() + 2000)
  expect(feedback.preview('window-1')).toEqual({ active: false })
})

it('keeps hidden-tab key feedback in its preview and clears it when another target is selected', async () => {
  feedback.select('tab-1', 7, window, content, false)
  await feedback.update({ x: 1800, y: 200, typing: true, key: '中', idleMs: 1600 }, signal)
  expect(feedback.preview('tab-1').keyboard).toEqual({ kind: 'typing', key: '中' })
  expect(marker.move).not.toHaveBeenCalled()
  expect(marker.feedback).not.toHaveBeenCalled()
  feedback.select('window-2', 8, { x: 0, y: 33, width: 800, height: 600 })
  expect(feedback.preview('tab-1')).toEqual({ active: false })
  expect(feedback.preview('window-2')).toEqual({ active: false })
})

it('positions keyboard-only feedback in the selected window without inventing a pointer movement', async () => {
  feedback.select('window-2', 8, window)
  await feedback.show(['Meta', 'A'], signal)
  expect(marker.select).toHaveBeenCalledWith(8, window, expect.any(AbortSignal))
  expect(marker.move).not.toHaveBeenCalled()
  expect(feedback.preview('window-2').cursor).toBeUndefined()
  expect(feedback.preview('window-2').keyboard).toEqual({ kind: 'shortcut', keys: ['⌘', 'A'] })
})

it('keeps drag feedback at delivered positions instead of predicting an independent arrival time', async () => {
  feedback.select('window-1', 7, window)
  const from = { x: 1600, y: 50 }, to = { x: 1800, y: 250 }
  marker.drag.mockImplementation(async (_pid: number, _from: { x: number; y: number }, _to: { x: number; y: number },
    _duration: number, _idle: number, _signal: AbortSignal, onPoint: (point: { x: number; y: number; at: number }) => void) => {
    vi.setSystemTime(Date.now() + 1000)
    expect(feedback.preview('window-1').cursor?.x).toBe((from.x - window.x) / window.width)
    onPoint({ x: 1700, y: 150, at: Date.now() })
    vi.setSystemTime(Date.now() + 1000)
    expect(feedback.preview('window-1').cursor?.x).toBe((1700 - window.x) / window.width)
    onPoint({ ...to, at: Date.now() })
  })
  await feedback.update({ pressed: true, idleMs: 1600 }, signal)
  await feedback.drag(9, from, to, signal)
  expect(feedback.preview('window-1').cursor?.x).toBe((to.x - window.x) / window.width)
})
