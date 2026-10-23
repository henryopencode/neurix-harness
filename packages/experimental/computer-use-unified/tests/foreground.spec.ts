/** Physical routing, calibrated custom controls, and cancellation before further input. */

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Config } from '../src/index.ts'
import { NativeCalls } from '../src/native.ts'
import { ComputerRuntime } from '../src/runtime.ts'
import { computerInput } from '../src/schema.ts'
import { CuaDriver, desktop, resetDesktop } from './fixtures/native.ts'

const marker = vi.hoisted(() => ({ move: vi.fn(), feedback: vi.fn(), close: vi.fn(), select: vi.fn(),
  type: vi.fn(), key: vi.fn(), click: vi.fn(), activate: vi.fn(), drag: vi.fn(), verifyWindow: vi.fn() }))
vi.mock('../src/overlay.ts', () => ({ MacOverlay: class {
  move = marker.move; feedback = marker.feedback; close = marker.close; select = marker.select
  type = marker.type; key = marker.key; click = marker.click
  activate = marker.activate
  drag = marker.drag
  verifyWindow = marker.verifyWindow
} }))
let runtime: ComputerRuntime
const signal = new AbortController().signal
const execute = (input: Record<string, unknown>, active = signal) => runtime.execute(computerInput.parse(input), active)
beforeEach(() => {
  resetDesktop(); vi.resetAllMocks()
  marker.type.mockImplementation(async (_pid: number, text: string) => {
    desktop.value = (desktop.selected ? '' : desktop.value) + text; desktop.selected = false
  })
  marker.key.mockImplementation(async (_pid: number, keys: readonly string[]) => {
    if (keys.join('+') === 'cmd+shift+down') desktop.selected = true
  })
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 15_000), Config({ inputMode: 'foreground', screenshots: false, cursorMoveDurationMs: 0 }))
})
afterEach(async () => { desktop.call = undefined; await runtime.close() })

it('uses current element geometry for a physical double click rather than AXPress', async () => {
  expect((await execute({ action: 'list' })).structuredContent?.inputMode).toBe('foreground')
  await execute({ action: 'observe', target: 'window-1' })
  await execute({ action: 'click', target: 'window-1', ref: 'field-1', count: 2 })
  expect(marker.click).toHaveBeenCalledWith(9, { x: 378, y: 238 }, 'left', 2, expect.any(AbortSignal))
  expect(desktop.calls.some(call => call.name === 'click')).toBe(false)
  expect(marker.move).toHaveBeenCalledWith({ x: 378, y: 238 }, 0, 1600, expect.any(AbortSignal), true, 7,
    { x: 100, y: 100, width: 560, height: 320 }, true)
})

it('applies a user-selected mode to the next operation without recreating targets', async () => {
  await runtime.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 15_000), Config({ inputMode: 'background', screenshots: false,
    cursorMoveDurationMs: 0 }))
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  const result = await runtime.execute(computerInput.parse({ action: 'click', target: 'window-1', ref: 'field-1' }), signal, 'foreground')
  expect(result.structuredContent?.inputMode).toBe('foreground')
  expect(marker.click).toHaveBeenCalledOnce()
  expect(desktop.calls.some(call => call.name === 'click')).toBe(false)
  await runtime.execute(computerInput.parse({ action: 'click', target: 'window-1', ref: 'field-2' }), signal, 'background')
  expect(marker.click).toHaveBeenCalledOnce()
  expect(desktop.calls.filter(call => call.name === 'click')).toHaveLength(1)
})

it('uses physical input after the user switches a blocked background window to foreground', async () => {
  await runtime.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 15_000), Config({ inputMode: 'background', screenshots: false,
    cursorMoveDurationMs: 0 }))
  desktop.extraElements = [{ element_token: 'contact', role: 'AXMenuItem', label: 'Contact',
    frame: { x: 128, y: 140, w: 250, h: 50 } }]
  desktop.call = async name => name === 'click' ? { content: [], structuredContent: {
    effect: 'unverifiable', route: 'accessibility', delivery: { mode: 'background' },
  } } : undefined
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  expect((await execute({ action: 'click', target: 'window-1', ref: 'contact' })).isError).toBe(true)
  await expect(execute({ action: 'key', target: 'window-1', keys: ['Return'] }))
    .rejects.toMatchObject({ code: 'BACKGROUND_EFFECT_UNCONFIRMED', effect: 'none' })
  const result = await runtime.execute(computerInput.parse({ action: 'click', target: 'window-1', ref: 'contact' }), signal, 'foreground')
  expect(result.isError).not.toBe(true)
  expect(result.structuredContent?.inputMode).toBe('foreground')
  expect(marker.click).toHaveBeenCalledOnce()
  expect(desktop.calls.filter(call => call.name === 'click')).toHaveLength(1)
})

it('waits for AppKit activation before window focus verification or physical input', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  const entered = Promise.withResolvers<undefined>(), active = Promise.withResolvers<undefined>()
  marker.activate.mockImplementationOnce(() => { entered.resolve(undefined); return active.promise })
  const clicking = execute({ action: 'click', target: 'window-1', ref: 'field-1' })
  await entered.promise
  expect(desktop.calls.some(call => call.name === 'bring_to_front')).toBe(false)
  expect(marker.click).not.toHaveBeenCalled()
  active.resolve(undefined)
  await clicking
  expect(marker.activate).toHaveBeenCalledWith(9, expect.any(AbortSignal))
  expect(desktop.calls.some(call => call.name === 'bring_to_front')).toBe(true)
  expect(marker.click).toHaveBeenCalledOnce()
})

it('uses exact system-window verification for an observed sheet without a separate AXWindow', async () => {
  await execute({ action: 'list' })
  desktop.call = async name => name === 'get_window_state' ? { content: [], structuredContent: {
    window_bounds: desktop.windows[0]?.bounds, screenshot_width: 1120, screenshot_height: 640, elements: [],
    background_input: { exact_window: { status: 'ax_unresolved' } },
  } } : name === 'list_windows' ? { content: [], structuredContent: { windows: desktop.windows } } : { content: [] }
  await execute({ action: 'observe', target: 'window-1' })
  await execute({ action: 'key', target: 'window-1', keys: ['return'] })
  expect(marker.verifyWindow).toHaveBeenCalledWith(9, 7, expect.any(AbortSignal))
  expect(marker.key).toHaveBeenCalledWith(9, ['return'], expect.any(AbortSignal))
  expect(desktop.calls.some(call => call.name === 'bring_to_front')).toBe(false)
})

it('does not dispatch to an unresolved AXWindow if exact system-window verification fails', async () => {
  await execute({ action: 'list' })
  desktop.call = async name => name === 'get_window_state' ? { content: [], structuredContent: {
    window_bounds: desktop.windows[0]?.bounds, elements: [], background_input: { exact_window: { status: 'ax_unresolved' } },
  } } : name === 'list_windows' ? { content: [], structuredContent: { windows: desktop.windows } } : { content: [] }
  await execute({ action: 'observe', target: 'window-1' })
  marker.verifyWindow.mockRejectedValueOnce(new Error('Another window is in front'))
  await expect(execute({ action: 'key', target: 'window-1', keys: ['return'] })).rejects.toThrow('Another window is in front')
  expect(marker.key).not.toHaveBeenCalled()
})

it('replaces a custom editor through click, selection and Unicode typing, then sends a single key', async () => {
  desktop.value = 'old editor text'
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1', screenshot: true })
  await execute({ action: 'type', target: 'window-1', x: 556, y: 276, replace: true, text: '中文✅' })
  expect(desktop.value).toBe('中文✅')
  expect(desktop.calls.some(call => call.name === 'set_value')).toBe(false)
  expect(desktop.calls.some(call => call.name === 'type_text')).toBe(false)
  await execute({ action: 'key', target: 'window-1', keys: ['Enter'] })
  expect(marker.key).toHaveBeenLastCalledWith(9, ['return'], expect.any(AbortSignal))
})

it('refuses a changed window or an outside drag destination before activation and mouse-down', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1', screenshot: true })
  await expect(execute({ action: 'drag', target: 'window-1', x: 1, y: 1, toX: 1120, toY: 1 }))
    .rejects.toMatchObject({ code: 'POINT_OUTSIDE_SCREENSHOT', effect: 'none' })
  desktop.windows[0]!.bounds!.x++
  await expect(execute({ action: 'click', target: 'window-1', ref: 'field-1' }))
    .rejects.toMatchObject({ code: 'WINDOW_MOVED', effect: 'none' })
  expect(desktop.calls.some(call => ['bring_to_front', 'click', 'drag'].includes(call.name))).toBe(false)
})

it('drives native drags and their cursor through one worker using calibrated global points', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1', screenshot: true })
  await execute({ action: 'drag', target: 'window-1', x: 2, y: 4, toX: 100, toY: 120 })
  expect(marker.drag).toHaveBeenCalledWith(9, { x: 101, y: 102 }, { x: 150, y: 160 }, 0, 1600,
    expect.any(AbortSignal), expect.any(Function))
  expect(desktop.calls.some(call => call.name === 'drag')).toBe(false)
  const preview = await runtime.capturePreview(signal)
  if (preview.kind !== 'frame') throw new Error('A dragged window must remain previewable')
  expect(typeof preview.cursor?.clickAt).toBe('number')
  expect(preview.cursor?.pressed).not.toBe(true)
})

it('sends no click after cancellation during the physical pointer glide', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  const controller = new AbortController()
  marker.move.mockImplementationOnce(() => { controller.abort(); return Promise.resolve() })
  await expect(execute({ action: 'click', target: 'window-1', ref: 'field-1' }, controller.signal)).rejects.toBeDefined()
  expect(desktop.calls.some(call => call.name === 'click')).toBe(false)
  expect(marker.click).not.toHaveBeenCalled()
})
