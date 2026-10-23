/** Browser ownership, dialogs, dispatch routes, and cancellation against an external fixture. */

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Config } from '../src/index.ts'
import { ComputerRuntime } from '../src/runtime.ts'
import { NativeCalls } from '../src/native.ts'
import { computerInput } from '../src/schema.ts'
import sharp from 'sharp'
import { CuaDriver, desktop, resetDesktop } from './fixtures/native.ts'
import { browserFixture, resetBrowser } from './fixtures/browser.ts'

const feedback = vi.hoisted(() => vi.fn(async (_page: unknown,
  _event: { pressed?: boolean; x?: number; y?: number; scroll?: string; typing?: boolean; key?: string; hold?: boolean }) => {}))
vi.mock('../src/browser-overlay.ts', () => ({ showBrowserFeedback: feedback }))

vi.mock('playwright', async () => ({ chromium: { launch: (await import('./fixtures/browser.ts')).launch } }))
vi.mock('../src/overlay.ts', () => ({ MacOverlay: class {
  move(): Promise<void> { return Promise.resolve() }
  feedback(): Promise<void> { return Promise.resolve() }
  close(): Promise<void> { return Promise.resolve() }
} }))

let runtime: ComputerRuntime
const signal = new AbortController().signal
beforeEach(() => {
  resetDesktop(); resetBrowser(); feedback.mockReset()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000),
    Config({ inputMode: 'background', showOverlay: false, screenshots: false, scrollDurationMs: 0, coordinateMaxAgeMs: 5000 }))
})
afterEach(async () => {
  browserFixture.closeError = undefined
  browserFixture.fail = undefined
  await runtime.close()
  vi.useRealTimers()
})
const execute = (args: Record<string, unknown>, active = signal) => runtime.execute(computerInput.parse(args), active)
const locator = { by: 'role', role: 'button', name: 'Save' }

it.skipIf(process.platform !== 'darwin')('connects an existing macOS browser when the user switches from background to foreground', async () => {
  await execute({ action: 'open_browser' })
  const browser = browserFixture.browsers[0]
  if (browser === undefined) throw new Error('The fixture browser was not opened')
  const connect = vi.spyOn(browser, 'newBrowserCDPSession')
  try {
    const result = await runtime.execute(computerInput.parse({ action: 'observe', target: 'tab-1', screenshot: true }), signal, 'foreground')
    expect(result.structuredContent?.inputMode).toBe('foreground')
    expect(connect).toHaveBeenCalledOnce()
    expect(browserFixture.browsers).toHaveLength(1)
    await runtime.execute(computerInput.parse({ action: 'observe', target: 'tab-1', screenshot: true }), signal, 'foreground')
    expect(connect).toHaveBeenCalledOnce()
  } finally { connect.mockRestore() }
})

it.skipIf(process.platform !== 'darwin')('retains the browser and readable state when the deferred foreground connection fails', async () => {
  await execute({ action: 'open_browser' })
  const browser = browserFixture.browsers[0]
  if (browser === undefined) throw new Error('The fixture browser was not opened')
  const connect = vi.spyOn(browser, 'newBrowserCDPSession').mockRejectedValueOnce(new Error('Native browser connection unavailable'))
  try {
    const result = await runtime.execute(computerInput.parse({ action: 'observe', target: 'tab-1', screenshot: true }), signal, 'foreground')
    expect(result.structuredContent).toMatchObject({ browserStatus: 'open', warnings: [{ code: 'SCREENSHOT_FAILED' }] })
    expect(JSON.stringify(result.structuredContent)).toContain('Native browser connection unavailable')
    expect(browserFixture.browsers).toHaveLength(1)
    expect(connect).toHaveBeenCalledOnce()
  } finally { connect.mockRestore() }
})

it('rejects unobserved and ambiguous locator targets before sending input', async () => {
  await execute({ action: 'open_browser' })
  browserFixture.locatorObserved = false
  await expect(execute({ action: 'click', target: 'tab-1', locator })).rejects.toMatchObject({ code: 'ELEMENT_NOT_OBSERVED', effect: 'none' })
  browserFixture.locatorObserved = true
  browserFixture.locatorCount = 2
  await expect(execute({ action: 'click', target: 'tab-1', locator })).rejects.toMatchObject({ code: 'ELEMENT_NOT_OBSERVED' })
  expect(browserFixture.calls.some(call => call.name === 'locator.click')).toBe(false)
  browserFixture.locatorCount = 1
  await execute({ action: 'observe', target: 'tab-1' })
  await execute({ action: 'click', target: 'tab-1', locator })
})

it('expires coordinate input before semantic input and invalidates observations on navigation', async () => {
  await execute({ action: 'open_browser', screenshot: true })
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + 5001)
  try {
    await expect(execute({ action: 'click', target: 'tab-1', x: 1, y: 1 })).rejects.toMatchObject({ code: 'SCREENSHOT_EXPIRED', effect: 'none' })
    await execute({ action: 'click', target: 'tab-1', locator })
    const page = browserFixture.browsers[0]?.context.pages[0]
    page?.emit('framenavigated', page)
    await expect(execute({ action: 'click', target: 'tab-1', locator })).rejects.toMatchObject({ code: 'OBSERVATION_REQUIRED' })
  } finally { vi.restoreAllMocks() }
})

it('uses browser-only resources without native discovery or shutdown on unsupported platforms', async () => {
  await runtime.close()
  runtime = new ComputerRuntime(undefined, Config({ headless: true, showOverlay: false, screenshots: false }))
  expect((await execute({ action: 'list' })).structuredContent).toMatchObject({ capabilities: { browser: true, native: false }, targets: [] })
  await expect(execute({ action: 'open_app', bundleId: 'com.apple.TextEdit' })).rejects.toMatchObject({ code: 'UNSUPPORTED_PLATFORM', effect: 'none' })
  await execute({ action: 'open_browser' })
  expect((await execute({ action: 'list' })).structuredContent?.targets).toMatchObject([{ kind: 'tab' }])
  await execute({ action: 'reset' })
  expect(desktop.calls).toEqual([])
})

it('retains an owned browser and independently tracks opened, popup, and closed tabs', async () => {
  const opened = await execute({ action: 'open_browser', url: 'https://example.com/' })
  expect(opened.structuredContent).toMatchObject({ target: 'tab-1', url: 'https://example.com/' })
  await execute({ action: 'new_tab', target: 'tab-1' })
  await browserFixture.browsers[0]?.context.newPage()
  expect((await execute({ action: 'list', query: 'tab-' })).structuredContent?.targets).toHaveLength(3)
  await execute({ action: 'close_tab', target: 'tab-2' })
  expect((await execute({ action: 'list', query: 'tab-' })).structuredContent?.targets).toHaveLength(2)
  await execute({ action: 'observe', target: 'tab-1', screenshot: true })
  await execute({ action: 'click', target: 'tab-1', x: 0, y: 3 })
  await execute({ action: 'navigate', target: 'tab-1', url: 'about:blank' })
  expect(browserFixture.browsers).toHaveLength(1)
  await execute({ action: 'reset' })
  await execute({ action: 'open_browser' })
  expect(browserFixture.browsers).toHaveLength(2)
})

it('reports result tabs opened by a page so the original tab is not mistaken for a failed submission', async () => {
  await execute({ action: 'open_browser', url: 'https://www.baidu.com' })
  const popup = await browserFixture.browsers[0]?.context.newPage()
  await popup?.goto('https://www.baidu.com/s?wd=test')
  const result = await execute({ action: 'observe', target: 'tab-1' })
  expect(result.structuredContent?.tabs).toEqual([
    { target: 'tab-1', url: 'https://www.baidu.com' }, { target: 'tab-2', url: 'https://www.baidu.com/s?wd=test' },
  ])
  expect(browserFixture.browsers).toHaveLength(1)
})

it('captures the viewport in screenshot pixels without dividing its CSS dimensions on Retina displays', async () => {
  await execute({ action: 'open_browser', screenshot: true })
  const capture = browserFixture.calls.find(call => call.name === 'screenshot')
  expect(capture?.args).toMatchObject([{ captureBeyondViewport: false, fromSurface: true }])
  expect(capture?.args[0]).not.toHaveProperty('clip')
})

it('uses strict semantic locators and explicit text replacement without a shared clipboard', async () => {
  await execute({ action: 'open_browser' })
  await execute({ action: 'click', target: 'tab-1', locator })
  await execute({ action: 'type', target: 'tab-1', locator: { by: 'label', text: 'Task name' }, text: 'replace', replace: true })
  await execute({ action: 'type', target: 'tab-1', locator: { by: 'css', selector: 'input' }, text: 'append' })
  await execute({ action: 'click', target: 'tab-1', locator: { by: 'text', text: 'Save' } })
  await execute({ action: 'key', target: 'tab-1', keys: ['ControlOrMeta', 'Enter'] })
  expect(browserFixture.calls).toContainEqual({ name: 'locator.fill', args: [''] })
  expect(browserFixture.calls.filter(call => call.name === 'keyboard.insertText').map(call => call.args[0]).join('')).toBe('replaceappend')
  expect(browserFixture.calls).toContainEqual({ name: 'keyboard.press', args: ['ControlOrMeta+Enter'] })
})

it('allows explicit navigation after failed input invalidates actionable observations', async () => {
  await execute({ action: 'open_browser' })
  browserFixture.fail = 'locator.click'
  await expect(execute({ action: 'click', target: 'tab-1', locator })).rejects.toMatchObject({ code: 'ACTION_FAILED' })
  browserFixture.fail = undefined
  expect((await execute({ action: 'navigate', target: 'tab-1', url: 'https://example.com/recovery' })).structuredContent)
    .toMatchObject({ status: 'observed', target: 'tab-1', url: 'https://example.com/recovery' })
  expect(browserFixture.browsers).toHaveLength(1)
})

it.each(['up', 'down', 'left', 'right'])('scrolls %s over an observed element', async (direction) => {
  await execute({ action: 'open_browser' })
  await execute({ action: 'scroll', target: 'tab-1', direction, amount: 100, locator })
  expect(browserFixture.calls.some(call => call.name === 'mouse.move')).toBe(true)
  expect(browserFixture.calls.some(call => call.name === 'mouse.wheel')).toBe(true)
})

it('requires screenshot grounding for pointer motion and releases drag buttons on failure', async () => {
  await execute({ action: 'open_browser' })
  await expect(execute({ action: 'click', target: 'tab-1', x: 0, y: 0 })).rejects.toMatchObject({ code: 'SCREENSHOT_REQUIRED' })
  await execute({ action: 'observe', target: 'tab-1', screenshot: true })
  await execute({ action: 'scroll', target: 'tab-1', direction: 'down', amount: 20, x: 0, y: 1, screenshot: true })
  await execute({ action: 'drag', target: 'tab-1', x: 0, y: 1, toX: 20, toY: 30, screenshot: true })
  expect(browserFixture.calls.some(call => call.name === 'mouse.up')).toBe(true)
})

it.each([true, false])('surfaces a blocking dialog and settles its input after accept=%s', async (accept) => {
  await execute({ action: 'open_browser' })
  browserFixture.dialogOnClick = true
  expect((await execute({ action: 'click', target: 'tab-1', locator })).structuredContent).toMatchObject({ status: 'dialog' })
  expect(browserFixture.calls.find(call => call.name === 'dialog.click')?.args).toMatchObject([{ timeout: 0 }])
  expect((await execute({ action: 'list', query: 'tab' })).structuredContent?.targets).toMatchObject([{ dialog: { type: 'confirm' } }])
  await expect(execute({ action: 'click', target: 'tab-1', locator })).rejects.toMatchObject({ code: 'DIALOG_OPEN' })
  await execute({ action: 'dialog', target: 'tab-1', accept })
  expect(browserFixture.calls.some(call => call.name === (accept ? 'dialog.accept' : 'dialog.dismiss'))).toBe(true)
  await expect(execute({ action: 'dialog', target: 'tab-1', accept })).rejects.toMatchObject({ code: 'NO_DIALOG' })
})

it('refuses invalid addressing and unsupported browser operations before external input', async () => {
  await execute({ action: 'open_browser' })
  for (const [args, code] of [
    [{ action: 'click', ref: 'native-token' }, 'LOCATOR_REQUIRED'],
    [{ action: 'type', text: 'text' }, 'LOCATOR_REQUIRED'],
    [{ action: 'click', locator, x: 1 }, 'AMBIGUOUS_ADDRESS'],
    [{ action: 'menu', path: ['File'] }, 'WINDOW_REQUIRED'],
  ] as const) {
    await execute({ action: 'observe', target: 'tab-1' })
    await expect(execute({ ...args, target: 'tab-1' })).rejects.toMatchObject({ code })
  }
  expect(browserFixture.calls.some(call => call.name === 'locator.click')).toBe(false)
})

it('interrupts blocked browser input on caller cancellation and invalidates its handles', async () => {
  await execute({ action: 'open_browser' })
  browserFixture.blocked = Promise.withResolvers<undefined>()
  browserFixture.entered = Promise.withResolvers<undefined>()
  const cancel = new AbortController()
  const blocked = execute({ action: 'click', target: 'tab-1', locator }, cancel.signal)
  const failed = expect(blocked).rejects.toMatchObject({ effect: 'possible' })
  await browserFixture.entered.promise
  cancel.abort(new Error('canceled'))
  await failed
  await expect(execute({ action: 'observe', target: 'tab-1' })).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' })
})

it('enforces the elapsed deadline with the same quiescent browser cleanup', async () => {
  await execute({ action: 'open_browser' })
  vi.useFakeTimers()
  browserFixture.blocked = Promise.withResolvers<undefined>()
  browserFixture.entered = Promise.withResolvers<undefined>()
  const blocked = execute({ action: 'click', target: 'tab-1', locator })
  const failed = expect(blocked).rejects.toMatchObject({ effect: 'possible' })
  await browserFixture.entered.promise
  await vi.advanceTimersByTimeAsync(15_000)
  await failed
})

it('keeps the opened tab after a screenshot fails and returns the usable page state', async () => {
  browserFixture.fail = 'screenshot'
  const opened = await execute({ action: 'open_browser', url: 'https://www.baidu.com', screenshot: true })
  expect(opened.structuredContent).toMatchObject({ status: 'observed', target: 'tab-1', browserStatus: 'open', tree: '- textbox "Task name"\n- button "Save"',
    warnings: [{ code: 'SCREENSHOT_FAILED' }] })
  expect(browserFixture.calls.some(call => call.name === 'browser.close')).toBe(false)
  browserFixture.fail = undefined
  await execute({ action: 'observe', target: 'tab-1', screenshot: false })
  expect(browserFixture.browsers).toHaveLength(1)
})

it('reports an open browser when page state cannot be read and reobserves the same tab', async () => {
  browserFixture.fail = 'snapshot'
  const opened = await execute({ action: 'open_browser', url: 'https://www.baidu.com' })
  expect(opened.structuredContent).toMatchObject({ status: 'partial', target: 'tab-1', browserStatus: 'open',
    warnings: [{ code: 'PAGE_STATE_UNAVAILABLE' }] })
  browserFixture.fail = undefined
  expect((await execute({ action: 'observe', target: 'tab-1' })).structuredContent).toMatchObject({ status: 'observed', target: 'tab-1' })
  expect(browserFixture.browsers).toHaveLength(1)
  expect(browserFixture.calls.some(call => call.name === 'browser.close')).toBe(false)
})

it('stops a timed out navigation without closing its browser or losing the tab', async () => {
  vi.useFakeTimers()
  browserFixture.blocked = Promise.withResolvers<undefined>()
  browserFixture.entered = Promise.withResolvers<undefined>()
  browserFixture.blockedOperation = 'goto'
  const opening = execute({ action: 'open_browser', url: 'https://www.baidu.com' })
  const result = expect(opening).resolves.toMatchObject({ structuredContent: { status: 'partial', target: 'tab-1', browserStatus: 'open',
    warnings: [{ code: 'TIMEOUT' }] } })
  await browserFixture.entered.promise
  await vi.advanceTimersByTimeAsync(30_000)
  await result
  expect(browserFixture.calls.some(call => call.name === 'browser.close')).toBe(false)
  expect(browserFixture.calls.some(call => call.name === 'Page.stopLoading')).toBe(true)
  browserFixture.blocked = undefined
  expect((await execute({ action: 'observe', target: 'tab-1' })).structuredContent?.target).toBe('tab-1')
  expect(browserFixture.browsers).toHaveLength(1)
})

it('retains the tab when the screenshot after a delivered click times out without replaying the click', async () => {
  await execute({ action: 'open_browser' })
  vi.useFakeTimers()
  browserFixture.blocked = Promise.withResolvers<undefined>()
  browserFixture.entered = Promise.withResolvers<undefined>()
  browserFixture.blockedOperation = 'screenshot'
  const clicking = execute({ action: 'click', target: 'tab-1', locator, screenshot: true })
  const result = expect(clicking).resolves.toMatchObject({ structuredContent: { status: 'observed', target: 'tab-1', browserStatus: 'open',
    warnings: [{ code: 'SCREENSHOT_FAILED' }, { code: 'TIMEOUT' }] } })
  await browserFixture.entered.promise
  await vi.advanceTimersByTimeAsync(15_000)
  await result
  expect(browserFixture.calls.filter(call => call.name === 'locator.click')).toHaveLength(1)
  expect(browserFixture.calls.some(call => call.name === 'browser.close')).toBe(false)
  browserFixture.blocked = undefined
  await execute({ action: 'observe', target: 'tab-1', screenshot: false })
  expect(browserFixture.calls.filter(call => call.name === 'locator.click')).toHaveLength(1)
  await expect(execute({ action: 'click', target: 'tab-1', x: 1, y: 1 })).rejects.toMatchObject({ code: 'SCREENSHOT_REQUIRED' })
})

it('settles canceled navigation before returning while leaving its window available for observation', async () => {
  browserFixture.blocked = Promise.withResolvers<undefined>()
  browserFixture.entered = Promise.withResolvers<undefined>()
  browserFixture.blockedOperation = 'goto'
  const controller = new AbortController()
  const opening = execute({ action: 'open_browser', url: 'https://www.baidu.com' }, controller.signal)
  const failed = expect(opening).rejects.toMatchObject({ code: 'CANCELED' })
  await browserFixture.entered.promise
  controller.abort(new Error('Stop loading'))
  await failed
  expect(browserFixture.calls.some(call => call.name === 'session.detach')).toBe(true)
  expect(browserFixture.calls.some(call => call.name === 'browser.close')).toBe(false)
  browserFixture.blocked = undefined
  expect((await execute({ action: 'observe', target: 'tab-1' })).structuredContent?.browserStatus).toBe('open')
})

it('keeps a background browser open when a missing selector times out before dispatch', async () => {
  await runtime.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000), Config({ inputMode: 'background', showOverlay: false, screenshots: false }))
  await execute({ action: 'open_browser' })
  vi.useFakeTimers()
  browserFixture.blocked = Promise.withResolvers<undefined>()
  browserFixture.entered = Promise.withResolvers<undefined>()
  browserFixture.blockedOperation = 'scrollIntoView'
  const typing = execute({ action: 'type', target: 'tab-1', locator: { by: 'css', selector: '#missing-field' }, text: '电脑控制测试' })
  const failed = expect(typing).rejects.toMatchObject({ code: 'TIMEOUT' })
  await browserFixture.entered.promise
  await vi.advanceTimersByTimeAsync(15_000)
  await failed
  expect(browserFixture.calls.some(call => call.name === 'browser.close')).toBe(false)
  expect(browserFixture.calls.some(call => call.name === 'keyboard.insertText' || call.name === 'mouse.click')).toBe(false)
  browserFixture.blocked = undefined
  expect((await execute({ action: 'observe', target: 'tab-1' })).structuredContent?.browserStatus).toBe('open')
})

it('shows each delivered browser grapheme and keeps the final key after input', async () => {
  await runtime.close()
  runtime = new ComputerRuntime(undefined, Config({ headless: true, showOverlay: true, screenshots: false, typingDelayMs: 0 }))
  await execute({ action: 'open_browser' })
  await execute({ action: 'type', target: 'tab-1', locator: { by: 'css', selector: '#title' }, text: '真a 👩‍💻\n\t实' })
  expect(browserFixture.calls.filter(call => call.name === 'keyboard.insertText').map(call => call.args[0]))
    .toEqual(['真', 'a', ' ', '👩‍💻', '\n', '\t', '实'])
  const keys = feedback.mock.calls.flatMap(([, event]) => event.key === undefined ? [] : [event.key])
  expect(keys).toEqual(['真', 'a', '␣', '👩‍💻', '↵', '⇥', '实', '实'])
  expect(feedback.mock.calls.at(-1)?.[1]).toMatchObject({ typing: true, key: '实', hold: false })
})

it('types complete text at fresh screenshot coordinates through one retained background tab', async () => {
  await runtime.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000), Config({ inputMode: 'background', showOverlay: false, screenshots: false,
    typingDelayMs: 0 }))
  await execute({ action: 'open_browser', screenshot: true })
  expect((await execute({ action: 'type', target: 'tab-1', x: 100, y: 90, text: '电脑控制测试' })).structuredContent?.browserStatus).toBe('open')
  expect(browserFixture.calls.filter(call => call.name === 'keyboard.insertText').map(call => call.args[0])).toEqual(['电', '脑', '控', '制', '测', '试'])
  expect(browserFixture.calls.filter(call => call.name === 'mouse.click')).toHaveLength(1)
  expect(browserFixture.browsers).toHaveLength(1)
  expect(browserFixture.calls.some(call => call.name === 'browser.close')).toBe(false)
})

it('uses a verified focused editor when typing without another address after a click', async () => {
  await runtime.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000), Config({ inputMode: 'background', showOverlay: false, screenshots: false,
    typingDelayMs: 0 }))
  await execute({ action: 'open_browser', screenshot: true })
  const clicked = await execute({ action: 'click', target: 'tab-1', x: 100, y: 90 })
  expect(clicked.structuredContent?.fields).toEqual([{ tag: 'textarea', placeholder: 'Task name', label: '', focused: true,
    locator: { by: 'css', selector: '#task-name' }, value: '', valueTruncated: false }])
  await execute({ action: 'type', target: 'tab-1', text: '电脑控制测试' })
  expect(browserFixture.calls.filter(call => call.name === 'keyboard.insertText').map(call => call.args[0])).toEqual(['电', '脑', '控', '制', '测', '试'])
  expect(browserFixture.calls.some(call => call.name === 'browser.close')).toBe(false)
})

it('reports failed opening and failed observation without replaying browser creation or input', async () => {
  browserFixture.launchError = new Error('Chrome missing')
  await expect(execute({ action: 'open_browser' })).rejects.toThrow('Chrome missing')
  browserFixture.launchError = undefined
  browserFixture.fail = 'goto'
  expect((await execute({ action: 'open_browser', url: 'https://example.com/' })).structuredContent).toMatchObject({ status: 'partial', target: 'tab-1',
    browserStatus: 'open', warnings: [{ code: 'NAVIGATION_FAILED' }] })
  browserFixture.fail = undefined
  await execute({ action: 'observe', target: 'tab-1' })
  browserFixture.fail = 'snapshot'
  expect((await execute({ action: 'click', target: 'tab-1', locator })).structuredContent).toMatchObject({ status: 'partial', target: 'tab-1',
    browserStatus: 'open', warnings: [{ code: 'PAGE_STATE_UNAVAILABLE' }] })
  expect(browserFixture.browsers).toHaveLength(1)
})

it('rolls back browser acquisition when context initialization fails', async () => {
  browserFixture.fail = 'newContext'
  await expect(execute({ action: 'open_browser' })).rejects.toThrow('newContext failed')
  expect(browserFixture.calls.some(call => call.name === 'browser.close')).toBe(true)
})

it('blocks reuse when browser cleanup fails', async () => {
  await execute({ action: 'open_browser' })
  browserFixture.closeError = new Error('browser did not close')
  await expect(execute({ action: 'reset' })).rejects.toThrow('Computer cleanup failed')
  await expect(execute({ action: 'list' })).rejects.toMatchObject({ code: 'CLOSING' })
  // close() retains the failed cleanup promise; the fixture owns final process cleanup.
  browserFixture.closeError = undefined
  await browserFixture.browsers[0]?.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000), Config({ inputMode: 'background', showOverlay: false, screenshots: false }))
})

it('enforces target and observation output limits without creating an extra tab', async () => {
  await runtime.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000), Config({ inputMode: 'background',
    showOverlay: false, screenshots: false, maxTargets: 1, maxSnapshotChars: 8, browserExecutablePath: '/fixture/chrome',
  }))
  expect((await execute({ action: 'open_browser' })).structuredContent).toMatchObject({ tree: '- textbo', truncated: true })
  await expect(execute({ action: 'new_tab', target: 'tab-1' })).rejects.toMatchObject({ code: 'TARGET_LIMIT' })
  expect(browserFixture.browsers[0]?.context.pages).toHaveLength(1)
  expect(browserFixture.calls.find(call => call.name === 'launch')?.args).toMatchObject([{ executablePath: '/fixture/chrome' }])
  await browserFixture.browsers[0]?.context.newPage()
  expect((await execute({ action: 'list', query: 'tab' })).structuredContent).toMatchObject({ closedPopups: 1, targets: [{ target: 'tab-1' }] })
  expect(browserFixture.calls.some(call => call.name === 'page.close')).toBe(true)
})

it('retains a failed popup close for teardown and refuses subsequent input', async () => {
  await runtime.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000), Config({ inputMode: 'background', showOverlay: false, screenshots: false, maxTargets: 1 }))
  await execute({ action: 'open_browser' })
  browserFixture.fail = 'page.close'
  await browserFixture.browsers[0]?.context.newPage()
  await expect(execute({ action: 'observe', target: 'tab-1' })).rejects.toThrow('page.close failed')
  browserFixture.fail = undefined
  await expect(runtime.close()).rejects.toThrow('page.close failed')
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000), Config({ inputMode: 'background', showOverlay: false, screenshots: false }))
})

it('keeps a dialog visible when its previously dispatched input fails during resolution', async () => {
  await execute({ action: 'open_browser' })
  browserFixture.dialogOnClick = true
  await execute({ action: 'click', target: 'tab-1', locator })
  browserFixture.fail = 'dialog_input'
  await expect(execute({ action: 'dialog', target: 'tab-1', accept: true })).rejects.toMatchObject({ code: 'ACTION_FAILED', effect: 'possible' })
})

it('resolves a page-owned dialog that opened outside a tool invocation', async () => {
  await execute({ action: 'open_browser' })
  let accepted = false
  browserFixture.browsers[0]?.context.pages[0]?.emit('dialog', {
    type: () => 'alert', message: () => 'External alert', defaultValue: () => '',
    accept() { accepted = true; return Promise.resolve() },
  })
  await execute({ action: 'dialog', target: 'tab-1', accept: true })
  expect(accepted).toBe(true)
})

it('retains the originating input until a pending dialog is resolved or reset closes its browser', async () => {
  await execute({ action: 'open_browser' })
  browserFixture.dialogOnClick = true
  await execute({ action: 'click', target: 'tab-1', locator })
  await execute({ action: 'reset' })
})

it('reports cancellation cleanup failure and prevents later reuse', async () => {
  await execute({ action: 'open_browser' })
  browserFixture.blocked = Promise.withResolvers<undefined>()
  browserFixture.entered = Promise.withResolvers<undefined>()
  browserFixture.closeError = new Error('Cannot terminate browser')
  const controller = new AbortController()
  const blocked = execute({ action: 'click', target: 'tab-1', locator }, controller.signal)
  const failed = expect(blocked).rejects.toMatchObject({ code: 'CLEANUP_FAILED' })
  await browserFixture.entered.promise
  controller.abort()
  browserFixture.blocked.reject(new Error('External input ended'))
  await failed
  await expect(execute({ action: 'list' })).rejects.toMatchObject({ code: 'CLOSING' })
  browserFixture.closeError = undefined
  await browserFixture.browsers[0]?.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000), Config({ inputMode: 'background', showOverlay: false, screenshots: false }))
})

it('refuses invalid URLs during navigation and handles a later external browser disconnection', async () => {
  await execute({ action: 'open_browser' })
  await expect(execute({ action: 'navigate', target: 'tab-1', url: 'file:///etc/passwd' })).rejects.toMatchObject({ code: 'INVALID_URL' })
  const old = browserFixture.browsers[0]
  await execute({ action: 'reset' })
  await execute({ action: 'open_browser' })
  old?.emit('disconnected')
  expect((await execute({ action: 'observe', target: 'tab-2' })).structuredContent?.target).toBe('tab-2')
})


it('resizes captured pixels on the Host while leaving the browser viewport and device metrics untouched', async () => {
  browserFixture.screenshotData = (await sharp({ create: {
    width: 2400, height: 1838, channels: 3, background: '#345678',
  } }).png().toBuffer()).toString('base64')
  const opened = await execute({ action: 'open_browser', screenshot: true })
  const full = opened.content.find(block => block.type === 'image')
  if (full?.type !== 'image') throw new Error('Missing observation image')
  expect(await sharp(Buffer.from(full.data, 'base64')).metadata()).toMatchObject({ width: 1200, height: 919 })
  const preview = await runtime.capturePreview(signal)
  if (preview.kind !== 'frame') throw new Error('Missing preview image')
  const png = Buffer.from(preview.imageUrl.split(',')[1] ?? '', 'base64')
  expect(await sharp(png).metadata()).toMatchObject({ width: 640, height: 490 })
  const captures = browserFixture.calls.filter(call => call.name === 'screenshot')
  expect(captures).toHaveLength(2)
  for (const capture of captures) expect(capture.args[0]).not.toHaveProperty('clip')
  expect(browserFixture.calls.some(call => call.name.startsWith('Emulation.'))).toBe(false)
})


it('paces held dragging, moves the software pointer with input, and clears the pressed state after release', async () => {
  await runtime.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000), Config({ inputMode: 'background',
    headless: true, showOverlay: true, screenshots: false, cursorMoveDurationMs: 100,
  }))
  await execute({ action: 'open_browser', screenshot: true })
  await execute({ action: 'drag', target: 'tab-1', x: 20, y: 30, toX: 140, toY: 80 })
  expect(browserFixture.calls.filter(call => call.name === 'mouse.down')).toHaveLength(1)
  expect(browserFixture.calls.filter(call => call.name === 'mouse.up')).toHaveLength(1)
  const events = feedback.mock.calls.map(call => call[1])
  const pressed = events.findIndex(event => event.pressed === true)
  expect(pressed).toBeGreaterThanOrEqual(0)
  expect(events.slice(pressed + 1, -1).length).toBeGreaterThan(1)
  expect(events.at(-2)).toMatchObject({ x: 140, y: 80 })
  expect(events.at(-1)).toMatchObject({ pressed: false })
})

it('releases held input and its display when cancellation interrupts a drag', async () => {
  await runtime.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000), Config({ inputMode: 'background',
    headless: true, showOverlay: true, screenshots: false, cursorMoveDurationMs: 0,
  }))
  await execute({ action: 'open_browser', screenshot: true })
  const cancel = new AbortController()
  feedback.mockImplementation(async (_page, event) => { if (event.pressed) cancel.abort(new Error('stop held drag')) })
  await expect(execute({ action: 'drag', target: 'tab-1', x: 20, y: 30, toX: 140, toY: 80 }, cancel.signal))
    .rejects.toMatchObject({ code: 'CANCELED' })
  expect(browserFixture.calls.some(call => call.name === 'mouse.up')).toBe(true)
  expect(feedback.mock.calls.at(-1)?.[1]).toMatchObject({ pressed: false })
})


it('resolves current drag source and destination rectangles without guessing screenshot coordinates', async () => {
  await runtime.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000), Config({ inputMode: 'background',
    showOverlay: false, screenshots: false, cursorMoveDurationMs: 0,
  }))
  const observed = await execute({ action: 'open_browser' })
  expect(observed.structuredContent).toMatchObject({ geometry: {
    viewport: { width: 1200, height: 919 }, elements: [{ locator: { by: 'css', selector: '#drag-source' } }],
  } })
  browserFixture.locatorBounds = {
    '#drag-source': { x: 160, y: 220, width: 40, height: 40 },
    '#drop-target': { x: 500, y: 300, width: 40, height: 80 },
  }
  await execute({ action: 'drag', target: 'tab-1', locator: { by: 'css', selector: '#drag-source' },
    toLocator: { by: 'css', selector: '#drop-target' }, toPosition: { x: 0.5, y: 0.2 } })
  const moves = browserFixture.calls.filter(call => call.name === 'mouse.move')
  expect(moves[0]?.args).toEqual([180, 240])
  expect(moves.at(-1)?.args).toEqual([520, 316])
  expect(browserFixture.calls.filter(call => call.name === 'mouse.down')).toHaveLength(1)
  expect(browserFixture.calls.filter(call => call.name === 'mouse.up')).toHaveLength(1)
})

it('rejects an ambiguous or offscreen drop target before mouse-down', async () => {
  await execute({ action: 'open_browser', screenshot: true })
  const source = { by: 'css', selector: '#drag-source' }
  const destination = { by: 'css', selector: '#drop-target' }
  await expect(execute({ action: 'drag', target: 'tab-1', locator: source, toLocator: destination, toX: 500, toY: 100 }))
    .rejects.toMatchObject({ code: 'AMBIGUOUS_ADDRESS', effect: 'none' })
  browserFixture.locatorBounds['#drop-target'] = { x: 2000, y: 30, width: 40, height: 40 }
  await expect(execute({ action: 'drag', target: 'tab-1', locator: source, toLocator: destination }))
    .rejects.toMatchObject({ code: 'POINT_OUTSIDE_VIEWPORT', effect: 'none' })
  expect(browserFixture.calls.some(call => call.name === 'mouse.down')).toBe(false)
})


it('scrolls inside the visible part of a large region and retains its directional preview cue briefly', async () => {
  await runtime.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000), Config({ inputMode: 'background',
    headless: true, showOverlay: true, screenshots: false, cursorMoveDurationMs: 0, scrollDurationMs: 0,
  }))
  vi.useFakeTimers({ toFake: ['Date'] })
  const started = Date.now()
  await execute({ action: 'open_browser' })
  browserFixture.locatorBounds['#page'] = { x: 0, y: -800, width: 1200, height: 2200 }
  await execute({ action: 'scroll', target: 'tab-1', locator: { by: 'css', selector: '#page' }, direction: 'down', amount: 480 })
  expect(browserFixture.calls).toContainEqual({ name: 'mouse.move', args: [600, 459.5] })
  expect(browserFixture.calls).toContainEqual({ name: 'mouse.wheel', args: [0, 480] })
  expect(feedback.mock.calls.at(-1)?.[1]).toMatchObject({ scroll: 'down' })
  expect(await runtime.capturePreview(signal)).toMatchObject({ kind: 'frame', action: 'scroll-down', active: true })
  vi.setSystemTime(started + 2000)
  expect(await runtime.capturePreview(signal)).toMatchObject({ kind: 'frame', action: 'scroll-down', active: false })
})


it('delegates continuous wheel input to the browser with an exact distance and bounded speed', async () => {
  await runtime.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000), Config({ inputMode: 'background',
    headless: true, showOverlay: true, screenshots: false, cursorMoveDurationMs: 0, scrollDurationMs: 100,
  }))
  await execute({ action: 'open_browser' })
  await execute({ action: 'scroll', target: 'tab-1', locator: { by: 'css', selector: 'body' }, direction: 'down', amount: 480 })
  expect(browserFixture.calls.find(call => call.name === 'Input.synthesizeScrollGesture')).toMatchObject({ args: [{
    x: 278, y: 78, xDistance: 0, yDistance: -480, speed: 4800, gestureSourceType: 'mouse', preventFling: true,
  }] })
  expect(browserFixture.calls.some(call => call.name === 'mouse.wheel')).toBe(false)
  expect(browserFixture.calls.some(call => call.name === 'session.detach')).toBe(true)
  expect(feedback.mock.calls.some(call => Reflect.get(call[1], 'hold') === true)).toBe(true)
  expect(feedback.mock.calls.at(-1)?.[1]).toMatchObject({ scroll: 'down', hold: false })
})

it('terminates an active browser gesture and withdraws its CDP session on cancellation', async () => {
  await runtime.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000), Config({ inputMode: 'background',
    showOverlay: false, screenshots: false, scrollDurationMs: 650,
  }))
  await execute({ action: 'open_browser' })
  browserFixture.blockedOperation = 'Input.synthesizeScrollGesture'
  browserFixture.blocked = Promise.withResolvers<undefined>()
  browserFixture.entered = Promise.withResolvers<undefined>()
  const cancel = new AbortController()
  const scrolling = execute({ action: 'scroll', target: 'tab-1', locator, direction: 'down', amount: 480 }, cancel.signal)
  const failed = expect(scrolling).rejects.toMatchObject({ code: 'CANCELED', effect: 'possible' })
  await browserFixture.entered.promise
  cancel.abort(new Error('stop scrolling'))
  await failed
  expect(browserFixture.calls.filter(call => call.name === 'Input.synthesizeScrollGesture')).toHaveLength(1)
  expect(browserFixture.calls.some(call => call.name === 'session.detach')).toBe(true)
})
