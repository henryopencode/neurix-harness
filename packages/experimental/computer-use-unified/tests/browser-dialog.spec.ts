/** Native dialog targeting, paced feedback, and preview isolation from blocked page JavaScript. */

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Config } from '../src/index.ts'
import { ComputerRuntime } from '../src/runtime.ts'
import { NativeCalls } from '../src/native.ts'
import { computerInput } from '../src/schema.ts'
import { CuaDriver, desktop, resetDesktop, screenshotBase64 } from './fixtures/native.ts'
import { browserFixture, resetBrowser } from './fixtures/browser.ts'

vi.mock('playwright', async () => ({ chromium: { launch: (await import('./fixtures/browser.ts')).launch } }))
vi.mock('../src/browser-overlay.ts', () => ({ showBrowserFeedback: vi.fn() }))
const marker = vi.hoisted(() => ({ move: vi.fn(),
  feedback: vi.fn(async (_event: { click?: boolean; typing?: boolean; key?: string; hold?: boolean; label?: string },
    _idleMs: number, _signal: AbortSignal) => {}), close: vi.fn(), select: vi.fn(), activate: vi.fn(),
  click: vi.fn(), type: vi.fn(), key: vi.fn(), drag: vi.fn() }))
vi.mock('../src/overlay.ts', () => ({ MacOverlay: class {
  move = marker.move; feedback = marker.feedback; close = marker.close
  select = marker.select; activate = marker.activate; click = marker.click; type = marker.type; key = marker.key
  drag = marker.drag
} }))

let runtime: ComputerRuntime
let acceptLabel: string, message: string, separate: boolean, duplicate: boolean, toolbarField: boolean, firstReadUnavailable: boolean
const originalPlatform = process.platform
const signal = new AbortController().signal
const execute = (args: Record<string, unknown>) => runtime.execute(computerInput.parse(args), signal)
const host = { x: 100, y: 100, width: 560, height: 320 }
const popup = { x: 200, y: 140, width: 300, height: 220 }
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  vi.resetAllMocks(); resetDesktop(); resetBrowser()
  acceptLabel = '确定'; message = 'Confirm operation?'; separate = false; duplicate = false; toolbarField = false; firstReadUnavailable = false
  desktop.windows = [{ pid: 9, window_id: 7, bounds: host }]
  desktop.call = async (name, args) => {
    if (name === 'list_windows') return { content: [], structuredContent: { windows: desktop.windows } }
    if (name === 'get_window_state') {
      if (firstReadUnavailable) {
        firstReadUnavailable = false
        return { content: [], structuredContent: { elements: [] } }
      }
      const visible = !separate || args.window_id !== 7
      return { content: args.include_screenshot ? [{ type: 'image', mimeType: 'image/png', data: screenshotBase64 }] : [],
        structuredContent: { elements: (visible ? [
          { element_token: 'root', element_index: 0, role: 'AXWindow', frame: { x: 100, y: 100, w: 560, h: 320 } },
          { element_token: 'message', element_index: 1, parent_index: 0, role: 'AXStaticText', label: message, frame: { x: 220, y: 160, w: 200, h: 30 } },
          { element_token: 'field', element_index: 2, parent_index: 0, role: 'AXTextField',
            frame: toolbarField && args.window_id === 7 ? { x: 120, y: 110, w: 200, h: 30 } : { x: 220, y: 200, w: 200, h: 30 } },
          { element_token: 'cancel', element_index: 3, parent_index: 0, role: 'AXButton', label: '取消', frame: { x: 300, y: 300, w: 60, h: 30 } },
          { element_token: 'ok', element_index: 4, parent_index: 0, role: 'AXButton', label: acceptLabel, frame: { x: 400, y: 300, w: 60, h: 30 } },
          ...duplicate ? [{ element_token: 'other-ok', element_index: 5, parent_index: 0, role: 'AXButton', label: 'OK', frame: { x: 450, y: 300, w: 40, h: 30 } }] : [],
          // Toolbar and menu controls must never become dialog feedback targets.
          { element_token: 'toolbar-ok', element_index: 6, parent_index: 8, role: 'AXButton', label: 'OK', frame: { x: 450, y: 120, w: 40, h: 30 } },
        ] : []).map(element => ({ ...element, depth: element.element_index === 0 ? 0 : 1 })).concat([
          { element_token: 'web-area', element_index: 99, role: 'AXWebArea', depth: 1,
            frame: { x: 100, y: 140, w: 560, h: 280 } },
        ]), elements_complete: false } }
    }
    return { content: [] }
  }
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 15_000),
    Config({ inputMode: 'background', screenshots: false, cursorMoveDurationMs: 0, typingDelayMs: 0 }))
})
afterEach(async () => {
  await runtime.close()
  Object.defineProperty(process, 'platform', { value: originalPlatform })
  vi.useRealTimers()
})

async function openDialog(type = 'confirm') {
  await execute({ action: 'open_browser' })
  browserFixture.dialogType = type
  browserFixture.dialogOnClick = true
  return execute({ action: 'click', target: 'tab-1', locator: { by: 'role', role: 'button', name: 'Save' } })
}

it('waits for a newly opened native dialog whose AX controls appear on the second read', async () => {
  await execute({ action: 'open_browser' })
  browserFixture.dialogOnClick = true
  const showing = browserFixture.browsers[0]?.context.pages[0]?.getByRole('button').click({ timeout: 0 })
  firstReadUnavailable = true
  const opened = await execute({ action: 'observe', target: 'tab-1' })
  expect(opened.structuredContent).toMatchObject({ status: 'dialog' })
  expect(opened.structuredContent).not.toHaveProperty('warnings')
  await execute({ action: 'dialog', target: 'tab-1', accept: true })
  await showing
  expect(browserFixture.calls.filter(call => call.name === 'dialog.accept')).toHaveLength(1)
})

it.each([true, false])('moves to the observed native control, shows a pulse, and resolves accept=%s once', async (accept) => {
  expect((await openDialog()).structuredContent).not.toHaveProperty('warnings')
  await execute({ action: 'dialog', target: 'tab-1', accept })
  expect(marker.move).toHaveBeenLastCalledWith({ x: accept ? 430 : 330, y: 315 }, 0, 1600, expect.any(AbortSignal), true, 7, host)
  expect(marker.feedback).toHaveBeenLastCalledWith({ click: true }, 1600, expect.any(AbortSignal))
  expect(browserFixture.calls.filter(call => call.name === (accept ? 'dialog.accept' : 'dialog.dismiss'))).toHaveLength(1)
  expect(desktop.calls.some(call => call.name === 'click' || call.name === 'hotkey')).toBe(false)
})

it('keeps a separate dialog in the background while retaining its host window for preview capture', async () => {
  await runtime.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 15_000),
    Config({ inputMode: 'foreground', screenshots: false, cursorMoveDurationMs: 0, keySettleMs: 0 }))
  separate = true
  desktop.windows.push({ pid: 9, window_id: 17, bounds: popup })
  await execute({ action: 'open_browser' })
  browserFixture.dialogOnClick = true
  const showing = browserFixture.browsers[0]?.context.pages[0]?.getByRole('button').click({ timeout: 0 })
  marker.click.mockImplementationOnce(async () => { await browserFixture.currentDialog?.accept() })
  try {
    await execute({ action: 'dialog', target: 'tab-1', accept: true })
    expect(desktop.calls.some(call => call.name === 'bring_to_front')).toBe(false)
    expect(marker.move).toHaveBeenCalledWith({ x: 430, y: 315 }, 0, 1600, expect.any(AbortSignal), true, 17, popup)
    expect(marker.click).not.toHaveBeenCalled()
    expect(desktop.calls.some(call => call.name === 'get_window_state' && call.args.window_id === 7 && call.args.display_only === true)).toBe(true)
  } finally {
    await browserFixture.currentDialog?.dismiss()
    await showing
  }
})

it('captures a foreground browser drag through native pixels without interrupting its renderer', async () => {
  await runtime.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 15_000),
    Config({ inputMode: 'foreground', screenshots: false, cursorMoveDurationMs: 0, keySettleMs: 0 }))
  await execute({ action: 'open_browser' })
  await execute({ action: 'move', target: 'tab-1', locator: { by: 'css', selector: '#drag-source' } })
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  marker.drag.mockImplementationOnce(async () => { entered.resolve(undefined); await release.promise })
  const dragged = execute({ action: 'drag', target: 'tab-1', locator: { by: 'css', selector: '#drag-source' },
    toLocator: { by: 'css', selector: '#drop-target' } })
  try {
    await entered.promise
    const screenshots = browserFixture.calls.filter(call => call.name === 'screenshot').length
    expect(await runtime.capturePreview(signal)).toMatchObject({ kind: 'frame', active: true, cursor: { pressed: true } })
    expect(browserFixture.calls.filter(call => call.name === 'screenshot')).toHaveLength(screenshots)
    expect(desktop.calls.at(-1)).toMatchObject({ name: 'get_window_state', args: {
      display_only: true, include_accessibility_tree: false, include_screenshot: true,
    } })
  } finally { release.resolve(undefined); await dragged }
})

it('types Unicode graphemes into a separate prompt through background AX and previews its window', async () => {
  separate = true
  desktop.windows.push({ pid: 9, window_id: 17, bounds: popup })
  await openDialog('prompt')
  const entered = Promise.withResolvers<undefined>(), resume = Promise.withResolvers<undefined>()
  marker.feedback.mockImplementation(async (event) => {
    if (event.key === '👩‍💻') { entered.resolve(undefined); await resume.promise }
  })
  const result = execute({ action: 'dialog', target: 'tab-1', accept: true, text: '中👩‍💻✅' })
  await entered.promise
  const preview = await runtime.capturePreview(signal)
  expect(preview).toMatchObject({ kind: 'frame', action: 'type', active: true, cursor: { x: 220 / 560, y: 115 / 320 },
    keyboard: { kind: 'typing', key: '👩‍💻' } })
  expect(desktop.calls.filter(call => call.name === 'get_window_state' && call.args.display_only === true).at(-1)?.args)
    .toMatchObject({ pid: 9, window_id: 7, include_accessibility_tree: false })
  resume.resolve(undefined); await result
  const writes = desktop.calls.filter(call => call.name === 'set_value')
  expect(writes.map(call => call.args.value)).toEqual(['', '中', '中👩‍💻', '中👩‍💻✅'])
  expect(marker.feedback.mock.calls.flatMap(([event]) => event.key === undefined ? [] : [event.key]))
    .toEqual(['中', '👩‍💻', '✅'])
  for (const write of writes) expect(write.args).toMatchObject({ pid: 9, window_id: 17, element_token: 'field' })
  expect(browserFixture.calls.filter(call => call.name === 'dialog.accept')).toEqual([{ name: 'dialog.accept', args: ['中👩‍💻✅'] }])
  const before = desktop.calls.length
  const clicked = await runtime.capturePreview(signal)
  expect(clicked).toMatchObject({ kind: 'frame', action: 'click', active: true })
  if (clicked.kind !== 'frame') throw new Error('Missing native dialog preview')
  expect(clicked.cursor?.clickAt).toBeTypeOf('number')
  expect(desktop.calls).toHaveLength(before)
})

it('uses the sole browser window when system bounds include a border absent from CDP', async () => {
  await openDialog()
  const bounds = { ...host, width: host.width + 2 }
  desktop.windows[0] = { pid: 9, window_id: 7, bounds }
  await execute({ action: 'dialog', target: 'tab-1', accept: false })
  expect(marker.move).toHaveBeenLastCalledWith({ x: 330, y: 315 }, 0, 1600, expect.any(AbortSignal), true, 7, bounds)
})

it.each(['different-process', 'ambiguous-host', 'hidden-other-host', 'wrong-message', 'ambiguous-buttons', 'unsupported-label', 'outside-host'])
('refuses %s without resolving the dialog or moving its marker', async (failure) => {
  await openDialog()
  marker.move.mockClear()
  if (failure === 'different-process') desktop.windows[0] = { pid: 10, window_id: 7, bounds: host }
  if (failure === 'ambiguous-host') {
    desktop.windows[0] = { pid: 9, window_id: 7, bounds: { ...host, x: 110 } }
    desktop.windows.push({ pid: 9, window_id: 17, bounds: { ...host, x: 120 } })
  }
  if (failure === 'hidden-other-host') {
    desktop.windows[0] = { pid: 9, window_id: 7, bounds: { ...host, width: host.width + 2 } }
    desktop.windows.push({ pid: 9, window_id: 17 })
  }
  if (failure === 'wrong-message') message = 'Another tab dialog'
  if (failure === 'ambiguous-buttons') duplicate = true
  if (failure === 'unsupported-label') acceptLabel = 'Unknown'
  if (failure === 'outside-host') {
    separate = true
    desktop.windows.push({ pid: 9, window_id: 17, bounds: { ...popup, x: 900 } })
  }
  await expect(execute({ action: 'dialog', target: 'tab-1', accept: true })).rejects.toMatchObject({ code: 'DIALOG_FEEDBACK_UNAVAILABLE', effect: 'none' })
  expect(marker.move).not.toHaveBeenCalled()
  expect(browserFixture.calls.some(call => call.name === 'dialog.accept' || call.name === 'dialog.dismiss')).toBe(false)
})

it('rebinds a changed popup position and never captures the blocked page runtime', async () => {
  separate = true
  desktop.windows.push({ pid: 9, window_id: 17, bounds: { ...popup, x: 180 } })
  await openDialog()
  desktop.windows[1] = { pid: 9, window_id: 17, bounds: popup }
  await execute({ action: 'dialog', target: 'tab-1', accept: false })
  expect(marker.move.mock.calls.at(-1)?.slice(-2)).toEqual([17, popup])
  const reads = desktop.calls.filter(call => call.name === 'get_window_state')
  expect(reads.some(call => call.args.window_id === 7 && call.args.display_only === true)).toBe(true)
  expect(browserFixture.calls.some(call => call.name === 'bringToFront')).toBe(false)
})

it('uses the sheet window when Chrome also exposes its identical controls in the host tree', async () => {
  toolbarField = true
  desktop.windows.push({ pid: 9, window_id: 17, bounds: popup })
  const opened = await openDialog()
  expect(opened.structuredContent).not.toHaveProperty('warnings')
  await execute({ action: 'dialog', target: 'tab-1', accept: false })
  expect(marker.move.mock.calls.at(-1)?.slice(-2)).toEqual([17, popup])
  expect(browserFixture.calls.filter(call => call.name === 'dialog.dismiss')).toHaveLength(1)
})

it('detaches a blocked page preview through the browser when a modal prevents renderer execution', async () => {
  await execute({ action: 'open_browser' })
  browserFixture.blockedOperation = 'Runtime.evaluate'
  browserFixture.entered = Promise.withResolvers<undefined>()
  browserFixture.blocked = Promise.withResolvers<undefined>()
  const controller = new AbortController()
  const capture = runtime.capturePreview(controller.signal)
  const failed = expect(capture).rejects.toThrow('stop preview')
  await browserFixture.entered.promise
  controller.abort(new Error('stop preview'))
  await failed
  expect(browserFixture.calls.filter(call => call.name === 'Target.detachFromTarget')).toHaveLength(1)
  expect(browserFixture.calls.some(call => call.name === 'Runtime.runIfWaitingForDebugger' || call.name === 'browser.close')).toBe(false)
})

it('uses the native window display and the same cursor projection for ordinary visible-page input', async () => {
  await execute({ action: 'open_browser' })
  await execute({ action: 'move', target: 'tab-1', locator: { by: 'css', selector: '#source' } })
  expect(marker.move).toHaveBeenLastCalledWith({ x: 100 + 278 * 560 / 1200, y: 140 + 78 * 280 / 919 },
    0, 1600, expect.any(AbortSignal), true, 7, host)
  const preview = await runtime.capturePreview(signal)
  if (preview.kind !== 'frame') throw new Error('Missing independent window preview')
  expect(preview.cursor?.x).toBeCloseTo(278 / 1200)
  expect(preview.cursor?.y).toBeCloseTo(78 / 919)
  await execute({ action: 'type', target: 'tab-1', locator: { by: 'css', selector: '#field' }, text: 'native display' })
  expect(marker.feedback).toHaveBeenCalledWith({ typing: true, hold: true }, 1600, expect.any(AbortSignal))
  expect((await runtime.capturePreview(signal))).toMatchObject({ kind: 'frame', keyboard: { kind: 'typing' } })
})
