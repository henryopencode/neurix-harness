/** Display-process framing, failure containment, and quiescent cancellation. */

import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { Script } from 'node:vm'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MacOverlay } from '../src/overlay.ts'
import { overlayScript } from '../src/overlay-script.ts'

const spawn = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn }))

class DisplayProcess extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly kill = vi.fn(() => { void Promise.resolve().then(() => { this.finish() }); return true })
  readonly messages: string[] = []
  constructor() {
    super()
    this.stdin.on('data', (value: Buffer) => { this.messages.push(value.toString()); this.emit('request', value.toString()) })
  }
  finish(): void { this.emit('close', 0, null) }
  nextRequest(): Promise<string> { return new Promise(resolve => this.once('request', resolve)) }
}

let overlay: MacOverlay
let process: DisplayProcess
const signal = new AbortController().signal
beforeEach(() => {
  vi.useFakeTimers()
  process = new DisplayProcess()
  spawn.mockReturnValue(process)
  overlay = new MacOverlay()
})
afterEach(async () => { await overlay.close(); vi.useRealTimers(); vi.clearAllMocks() })

it('parses the complete native worker program before launching it', () => {
  expect(() => new Script(overlayScript)).not.toThrow()
})

it('reports the current Unicode key without completing the in-flight typing request', async () => {
  const request = process.nextRequest()
  const keys: string[] = []
  let completed = false
  const typed = overlay.type(9, '中🙂', 45, signal, key => keys.push(key)).then(() => { completed = true })
  process.stdout.write('{"ready":true}\n')
  const message = JSON.parse(await request) as { id: number; characters: string[] }
  expect(message.characters).toEqual(['中', '🙂'])
  process.stdout.write(JSON.stringify({ id: message.id, key: '中' }) + '\n')
  await Promise.resolve()
  expect(keys).toEqual(['中'])
  expect(completed).toBe(false)
  process.stdout.write(JSON.stringify({ id: message.id, key: '🙂' }) + '\n')
  process.stdout.write(JSON.stringify({ id: message.id }) + '\n')
  await typed
  expect(keys).toEqual(['中', '🙂'])
})

it('streams delivered drag positions and completes only after the worker acknowledges release', async () => {
  const request = process.nextRequest()
  const points: Array<{ x: number; y: number; at: number }> = []
  let completed = false
  const dragged = overlay.drag(9, { x: 10, y: 20 }, { x: 110, y: 120 }, 450, 1600, signal,
    point => points.push(point)).then(() => { completed = true })
  process.stdout.write('{"ready":true}\n')
  const message = JSON.parse(await request) as { id: number; action: string }
  expect(message).toMatchObject({ action: 'drag', pid: 9, from: { x: 10, y: 20 }, to: { x: 110, y: 120 } })
  process.stdout.write(JSON.stringify({ id: message.id, point: { x: 60, y: 70, at: 100 } }) + '\n')
  await Promise.resolve()
  expect(points).toEqual([{ x: 60, y: 70, at: 100 }])
  expect(completed).toBe(false)
  process.stdout.write(JSON.stringify({ id: message.id }) + '\n')
  await dragged
  expect(completed).toBe(true)
})

it('requests drag release before cancellation can terminate its worker', async () => {
  const request = process.nextRequest(), controller = new AbortController()
  const dragged = overlay.drag(9, { x: 10, y: 20 }, { x: 110, y: 120 }, 450, 1600, controller.signal, () => {})
  const failed = expect(dragged).rejects.toMatchObject({ name: 'AbortError' })
  process.stdout.write('{"ready":true}\n')
  await request
  controller.abort()
  expect(process.messages.some(message => message.includes('"action":"cancel"'))).toBe(true)
  expect(process.kill).not.toHaveBeenCalled()
  process.stdout.write('{"error":"Input canceled after mouse-up.","code":"CANCELED"}\n')
  await failed
  expect(process.kill).toHaveBeenCalled()
})

it('closes an active input worker through its release command before awaiting process exit', async () => {
  const request = process.nextRequest()
  const dragged = overlay.drag(9, { x: 10, y: 20 }, { x: 110, y: 120 }, 450, 1600, signal, () => {})
  const failed = expect(dragged).rejects.toThrow('stopped')
  process.stdout.write('{"ready":true}\n')
  await request
  const closingRequest = process.nextRequest()
  const closed = overlay.close()
  expect(JSON.parse(await closingRequest)).toMatchObject({ action: 'close' })
  expect(process.kill).not.toHaveBeenCalled()
  process.finish()
  await closed
  await failed
})

it('requests cancellation before terminating a worker that may be releasing shortcut modifiers', async () => {
  const request = process.nextRequest()
  const controller = new AbortController()
  const typed = overlay.type(9, 'long input', 45, controller.signal, () => {})
  process.stdout.write('{"ready":true}\n')
  await request
  controller.abort()
  expect(process.messages.some(message => message.includes('"action":"cancel"'))).toBe(true)
  expect(process.kill).not.toHaveBeenCalled()
  process.stdout.write('{"error":"Input canceled.","code":"CANCELED"}\n')
  await expect(typed).rejects.toMatchObject({ name: 'AbortError' })
  expect(process.kill).toHaveBeenCalled()
})

it('waits for readiness and arrival, then stops its heartbeat and process on disposal', async () => {
  const request = process.nextRequest()
  const moved = overlay.move({ x: 280, y: 320 }, 450, 1600, signal, true, 7, { x: 100, y: 100, width: 560, height: 320 })
  expect(process.messages).toEqual([])
  process.stdout.write('{"ready":true}\n')
  expect(JSON.parse(await request)).toMatchObject({ id: 1, action: 'move', x: 280, y: 320, durationMs: 450, visible: true })
  process.stdout.write('{"id":1}\n')
  await moved
  await vi.advanceTimersByTimeAsync(32)
  expect(process.messages.filter(line => line.includes('tick'))).toHaveLength(2)
  await overlay.close()
  const before = process.messages.length
  await vi.advanceTimersByTimeAsync(100)
  expect(process.messages).toHaveLength(before)
  expect(process.kill).toHaveBeenCalledOnce()
})

it('does not settle cancellation until the moving display process has exited', async () => {
  process.kill.mockImplementation(() => true)
  const controller = new AbortController()
  const request = process.nextRequest()
  const moving = overlay.move({ x: 10, y: 20 }, 450, 1600, controller.signal, true, 7, { x: 100, y: 100, width: 560, height: 320 })
  const failed = expect(moving).rejects.toThrow('stop cursor')
  process.stdout.write('{"ready":true}\n')
  await request
  controller.abort(new Error('stop cursor'))
  expect(process.kill).toHaveBeenCalled()
  let settled = false
  void moving.then(() => { settled = true }, () => { settled = true })
  await Promise.resolve()
  expect(settled).toBe(false)
  process.finish()
  await failed
})

it.each(['not-json\n', '[]\n', '{"error":"Cursor movement refused by macOS"}\n'])('contains an invalid or refused display response: %s', async (response) => {
  const request = process.nextRequest()
  const failed = expect(overlay.feedback({ label: '⌘  A' }, 1600, signal)).rejects.toMatchObject({ code: 'OVERLAY_UNAVAILABLE', effect: 'possible' })
  process.stdout.write('{"ready":true}\n')
  await request
  process.stdout.write(response)
  await failed
  expect(process.kill).toHaveBeenCalled()
})

it('reports startup diagnostics and releases the failed process before another attempt', async () => {
  const failed = expect(overlay.feedback({ click: true }, 1600, signal)).rejects.toThrow('AppKit unavailable')
  process.stderr.write('AppKit unavailable')
  process.finish()
  await failed
  const replacement = new DisplayProcess()
  spawn.mockReturnValue(replacement)
  const request = replacement.nextRequest()
  const shown = overlay.feedback({ label: '⇧  A' }, 1600, signal)
  replacement.stdout.write('{"ready":true}\n')
  expect(await request).toContain('⇧  A')
  replacement.stdout.write('{"id":1}\n')
  await shown
})


it('forwards the wheel direction through the private display protocol', async () => {
  const request = process.nextRequest()
  const shown = overlay.feedback({ scroll: 'down' }, 1600, signal)
  process.stdout.write('{"ready":true}\n')
  expect(JSON.parse(await request)).toMatchObject({ action: 'feedback', scroll: 'down', idleMs: 1600 })
  process.stdout.write('{"id":1}\n')
  await shown
})
