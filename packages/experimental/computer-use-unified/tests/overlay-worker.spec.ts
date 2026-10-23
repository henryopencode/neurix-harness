/** Keyboard labels rendered by the complete AppKit worker across input and idle frames. */

import { Script } from 'node:vm'
import { expect, it } from 'vitest'
import { overlayScript } from '../src/overlay-script.ts'

function runWorker(steps: readonly { at: number; commands?: readonly Record<string, unknown>[] }[]) {
  const rendered: string[] = [], replies: unknown[] = [], delivered: { text: string; down: boolean }[] = []
  const labels: { stringValue: string; fittingSize: { height: number }; lastBaselineOffsetFromBottom: number }[] = []
  let now = 1000, next = 0, buffered = ''
  const inert: () => void = new Proxy(() => {}, { get: (_target, name) => name === Symbol.toPrimitive ? () => 0 : inert,
    apply: () => inert })
  const api: Record<string, unknown> = {
    NSFileHandle: {
      fileHandleWithStandardInput: {
        get availableData() {
          const step = steps[next++]
          if (step === undefined) return { length: 0 }
          now = 1000 + step.at
          const text = (step.commands ?? [{ action: 'tick' }]).map(command => JSON.stringify(command) + '\n').join('')
          return { length: text.length, text }
        },
      },
      fileHandleWithStandardOutput: { writeData: (data: { text: string }) => { replies.push(JSON.parse(data.text)) } },
    },
    NSMutableData: { data: {
      appendData: (data: { text: string }) => { buffered += data.text },
      setLength: () => { buffered = '' },
    } },
    NSString: { alloc: { initWithDataEncoding: () => ({ text: buffered, isNil: () => false }) } },
    NSTextField: { labelWithString: (stringValue: string) => {
      const label = { stringValue, fittingSize: { height: 30 }, lastBaselineOffsetFromBottom: 0 }
      labels.push(label)
      return label
    } },
    NSScreen: { screens: { objectAtIndex: () => ({ frame: { size: { height: 1000 } } }) } },
    NSRunningApplication: { runningApplicationWithProcessIdentifier: () => ({ active: true, isNil: () => false }) },
    CTLineGetBoundsWithOptions: () => ({ origin: { y: 0 }, size: { width: 16, height: 24 } }),
    CGEventCreateKeyboardEvent: (_source: unknown, _code: number, down: boolean) => ({ text: '', down }),
    CGEventKeyboardSetUnicodeString: (event: { text: string }, _length: number, bytes: string) => { event.text = bytes },
    CGEventPost: (_tap: number, event: { text: string; down: boolean }) => { delivered.push({ ...event }) },
    NSRunLoop: { currentRunLoop: { runUntilDate: () => { rendered.push(labels[0]?.stringValue ?? '') } } },
  }
  // AppKit drawing is inert; the input pipe, clock, label, and posted events remain observable.
  const cocoa = new Proxy((text: string) => ({ dataUsingEncoding: () => ({ text, bytes: text }) }), {
    get: (_target, name) => typeof name === 'string' ? api[name] ?? inert : inert,
  })
  new Script(overlayScript).runInNewContext({
    $: cocoa,
    ObjC: { import: () => {}, bindFunction: () => {}, unwrap: (value: { text: string }) => value.text },
    Date: { now: () => now },
  }, { timeout: 1000 })
  return { rendered, replies, delivered }
}

it('keeps each delivered foreground key visible between characters and after typing completes', () => {
  const result = runWorker([
    { at: 0, commands: [{ action: 'feedback', typing: true, hold: true, idleMs: 1600, id: 1 }] },
    { at: 16, commands: [{ action: 'type', pid: 9, characters: ['中', '🙂'], delayMs: 45, id: 2 }] },
    ...[32, 48, 64, 80, 96, 112, 128].map(at => ({ at })),
    { at: 144, commands: [{ action: 'feedback', typing: true, key: '🙂', idleMs: 1600, id: 3 }] },
    { at: 160 },
  ])
  expect(result.rendered).toEqual(['', '中', '中', '中', '🙂', '🙂', '🙂', '🙂', '🙂', '🙂', '🙂'])
  expect(result.delivered).toEqual([
    { text: '中', down: true }, { text: '中', down: false },
    { text: '🙂', down: true }, { text: '🙂', down: false },
  ])
  expect(result.replies).toEqual([{ ready: true }, { id: 1 }, { id: 2, key: '中' }, { id: 2, key: '🙂' }, { id: 2 }, { id: 3 }])
})

it('preserves typed letter case and complete graphemes in the overlay and preview replies', () => {
  const characters = ['a', 'A', 'ß', 'é', '👩🏽‍💻', '\t', ' ']
  const captions = ['a', 'A', 'ß', 'é', '👩🏽‍💻', '⇥', '␣']
  const result = runWorker([
    { at: 0, commands: [{ action: 'feedback', typing: true, hold: true, idleMs: 1600, id: 1 }] },
    { at: 16, commands: [{ action: 'type', pid: 9, characters, delayMs: 32, id: 2 }] },
    ...Array.from({ length: characters.length * 2 }, (_, index) => ({ at: 32 + index * 16 })),
  ])
  expect(result.rendered).toEqual(['', ...captions.flatMap(key => [key, key]), '␣'])
  expect(result.replies).toEqual([{ ready: true }, { id: 1 }, ...captions.map(key => ({ id: 2, key })), { id: 2 }])
  expect(result.delivered).toEqual(characters.flatMap(text => [{ text, down: true }, { text, down: false }]))
})

it('leaves the keycap empty while waiting and retains supplied background keys between frames', () => {
  const result = runWorker([
    { at: 0, commands: [{ action: 'feedback', typing: true, hold: true, idleMs: 1600, id: 1 },
      { action: 'type', pid: 9, characters: ['中'], delayMs: 45, id: 2 }] },
    { at: 48 },
    { at: 64, commands: [{ action: 'feedback', typing: true, hold: true, idleMs: 1600, id: 3 }] },
    { at: 244 },
    { at: 424, commands: [{ action: 'feedback', typing: true, key: '真', hold: true, idleMs: 1600, id: 4 }] },
    { at: 604 },
    { at: 784, commands: [{ action: 'feedback', typing: true, key: '实', hold: true, idleMs: 1600, id: 5 }] },
    { at: 964 },
  ])
  expect(result.rendered).toEqual(['中', '中', '', '', '真', '真', '实', '实'])
  expect(result.delivered).toEqual([{ text: '中', down: true }, { text: '中', down: false }])
})
