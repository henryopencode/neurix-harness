/** Background input keeps the user's pointer, focus, and foreground window untouched. */

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Config } from '../src/index.ts'
import { NativeCalls } from '../src/native.ts'
import { ComputerRuntime } from '../src/runtime.ts'
import { computerInput } from '../src/schema.ts'
import { overlayScript } from '../src/overlay-script.ts'
import { CuaDriver, desktop, resetDesktop } from './fixtures/native.ts'

const marker = vi.hoisted(() => ({ move: vi.fn(), feedback: vi.fn(), close: vi.fn(), select: vi.fn() }))
vi.mock('../src/overlay.ts', () => ({ MacOverlay: class {
  move = marker.move; feedback = marker.feedback; close = marker.close; select = marker.select
} }))
let runtime: ComputerRuntime
const signal = new AbortController().signal
const execute = (input: Record<string, unknown>) => runtime.execute(computerInput.parse(input), signal)
beforeEach(() => {
  resetDesktop(); vi.resetAllMocks()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 15_000), Config({ inputMode: 'background', screenshots: false }))
})
afterEach(async () => { desktop.call = undefined; await runtime.close() })

it('moves only the software marker and directs input to exact background elements', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  await execute({ action: 'move', target: 'window-1', ref: 'field-1' })
  expect(marker.move).toHaveBeenCalledWith({ x: 378, y: 238 }, 450, 1600, expect.any(AbortSignal), true, 7,
    { x: 100, y: 100, width: 560, height: 320 })
  expect(await runtime.capturePreview(signal)).toMatchObject({ kind: 'frame',
    cursor: { x: (378 - 100) / 560, y: (238 - 100) / 320 }, active: true })
  await execute({ action: 'click', target: 'window-1', ref: 'field-2' })
  await execute({ action: 'type', target: 'window-1', ref: 'field-3', text: '独立后台输入' })
  expect(desktop.value).toBe('独立后台输入')
  expect(desktop.calls.some(call => call.name === 'bring_to_front' || call.args.scope === 'desktop')).toBe(false)
  for (const name of ['click', 'type_text']) expect(desktop.calls.find(call => call.name === name)?.args)
    .toMatchObject({ pid: 9, window_id: 7, delivery_mode: 'background' })
  expect(overlayScript).not.toContain('orderFrontRegardless')
})

it('reports unsupported native dragging and background refusals without foreground fallback', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1', screenshot: true })
  await expect(execute({ action: 'drag', target: 'window-1', x: 1, y: 1, toX: 10, toY: 10 })).rejects.toMatchObject({ code: 'BACKGROUND_UNAVAILABLE', effect: 'none' })
  desktop.call = async name => name === 'list_windows' ? { content: [], structuredContent: { windows: desktop.windows } }
    : { content: [], structuredContent: { refusal: { code: 'background_unavailable', message: 'This app requires foreground input.' } } }
  await expect(execute({ action: 'key', target: 'window-1', keys: ['cmd', 's'] })).rejects.toMatchObject({ code: 'background_unavailable' })
  expect(desktop.calls.some(call => call.name === 'bring_to_front' || call.name === 'drag' || call.args.delivery_mode === 'foreground')).toBe(false)
})


it('shows delivered native wheel input as directional feedback without sending foreground events', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  await execute({ action: 'scroll', target: 'window-1', ref: 'field-1', direction: 'down', amount: 3 })
  expect(marker.feedback).toHaveBeenCalledWith({ scroll: 'down' }, 1600, expect.any(AbortSignal))
  expect(desktop.calls.find(call => call.name === 'scroll')?.args).toMatchObject({
    pid: 9, window_id: 7, direction: 'down', delivery_mode: 'background',
  })
  expect(await runtime.capturePreview(signal)).toMatchObject({ kind: 'frame', action: 'scroll-down', active: true })
})
