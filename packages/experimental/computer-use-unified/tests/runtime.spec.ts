/** Target ownership, grounded input, effect reporting, and native call ordering. */

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Config } from '../src/index.ts'
import { ComputerRuntime } from '../src/runtime.ts'
import { NativeCalls } from '../src/native.ts'
import { computerInput } from '../src/schema.ts'
import { CuaDriver, desktop, resetDesktop, screenshotBase64 } from './fixtures/native.ts'

const signal = new AbortController().signal
let runtime: ComputerRuntime

beforeEach(() => {
  resetDesktop()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000), Config({ inputMode: 'background', showOverlay: false, screenshots: false }))
})
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); desktop.call = undefined; await runtime.close() })

const execute = (args: Record<string, unknown>) => runtime.execute(computerInput.parse(args), signal)

it('keeps browser-only background mode out of native discovery, launch, and existing window operations', async () => {
  await runtime.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000), Config({ nativeBackground: false,
    inputMode: 'background', showOverlay: false, screenshots: false }))
  expect((await execute({ action: 'list' })).structuredContent).toMatchObject({ targets: [],
    capabilities: { browser: true, native: false, nativeForeground: true, nativeBackground: false } })
  await expect(execute({ action: 'open_app', bundleId: 'ai.neurix.fixture' }))
    .rejects.toMatchObject({ code: 'NATIVE_FOREGROUND_REQUIRED', effect: 'none' })
  expect(desktop.calls).toEqual([])
  expect((await runtime.execute(computerInput.parse({ action: 'list' }), signal, 'foreground')).structuredContent)
    .toMatchObject({ targets: [{ target: 'window-1' }], capabilities: { native: true } })
  const discovered = desktop.calls.length
  for (const action of [
    { action: 'observe' }, { action: 'click', ref: 'field-1' }, { action: 'type', ref: 'field-1', text: 'Denied' },
    { action: 'key', keys: ['Return'] }, { action: 'menu', path: ['Actions'] },
  ]) await expect(execute({ target: 'window-1', ...action }))
    .rejects.toMatchObject({ code: 'NATIVE_FOREGROUND_REQUIRED', effect: 'none' })
  expect(desktop.calls).toHaveLength(discovered)
  expect((await execute({ action: 'list' })).structuredContent).toMatchObject({ targets: [], capabilities: { native: false } })
})

it('blocks dependent background input after an unconfirmed click even when the model ignores recovery instructions', async () => {
  desktop.extraElements = [{ element_token: 'contact', role: 'AXMenuItem', label: 'Contact',
    frame: { x: 128, y: 140, w: 250, h: 50 } }]
  desktop.call = async name => name === 'click' ? { content: [], structuredContent: {
    effect: 'unverifiable', route: 'accessibility', delivery: { mode: 'background' }, summary: 'AXPress delivered.',
  } } : undefined
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1', screenshot: true })
  const clicked = await execute({ action: 'click', target: 'window-1', ref: 'contact', screenshot: true })
  expect(clicked.isError).toBe(true)
  expect(clicked.structuredContent).toMatchObject({ code: 'BACKGROUND_EFFECT_UNCONFIRMED', effect: 'possible',
    actionResult: { effect: 'unverifiable' } })
  expect(clicked.content.some(block => block.type === 'image')).toBe(true)
  for (const action of [
    { action: 'click', ref: 'contact' }, { action: 'click', x: 1, y: 1 }, { action: 'key', keys: ['Return'] },
    { action: 'type', ref: 'field-2', text: 'unsafe' }, { action: 'menu', path: ['Window', 'Bring all to front'] },
  ]) await expect(execute({ target: 'window-1', ...action })).rejects.toMatchObject({
    code: 'BACKGROUND_EFFECT_UNCONFIRMED', effect: 'none',
  })
  expect(desktop.calls.filter(call => ['click', 'type_text', 'hotkey', 'invoke_menu'].includes(call.name))).toHaveLength(1)
  expect((await execute({ action: 'observe', target: 'window-1' })).structuredContent?.code).toBe('BACKGROUND_EFFECT_UNCONFIRMED')
  desktop.extraElements = []
  await execute({ action: 'observe', target: 'window-1' })
  await execute({ action: 'type', target: 'window-1', ref: 'field-4', text: 'verified change' })
  expect(desktop.value).toBe('verified change')
})

it.each([false, true])('does not clear blocked input when an incomplete or filtered tree omits its control (complete=%s)', async (complete) => {
  desktop.extraElements = [{ element_token: 'contact', role: 'AXMenuItem', label: 'Contact',
    frame: { x: 128, y: 140, w: 250, h: 50 } }]
  desktop.call = async name => name === 'click' ? { content: [], structuredContent: {
    effect: 'suspected_noop', route: 'accessibility', delivery: { mode: 'background' },
  } } : undefined
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  await execute({ action: 'click', target: 'window-1', ref: 'contact' })
  desktop.call = async name => name === 'get_window_state' ? { content: [], structuredContent: {
    elements: [], elements_complete: complete,
  } } : undefined
  await execute({ action: 'observe', target: 'window-1', query: 'Other control' })
  await expect(execute({ action: 'key', target: 'window-1', keys: ['Return'] }))
    .rejects.toMatchObject({ code: 'BACKGROUND_EFFECT_UNCONFIRMED', effect: 'none' })
  expect(desktop.calls.some(call => call.name === 'hotkey')).toBe(false)
})

it.each(['value', 'selected'] as const)('continues background input after a clicked control changes %s in an incomplete tree', async (field) => {
  const contact = { element_token: 'contact', role: 'AXCheckBox', label: 'Contacts', value: '0', selected: false,
    frame: { x: 128, y: 140, w: 250, h: 50 } }
  desktop.extraElements = [contact]
  desktop.elementsComplete = false
  desktop.call = async (name) => {
    if (name !== 'click') return undefined
    desktop.extraElements = [{ ...contact, [field]: field === 'value' ? '1' : true }]
    return { content: [], structuredContent: {
      effect: 'unverifiable', route: 'accessibility', delivery: { mode: 'background' },
    } }
  }
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  const clicked = await execute({ action: 'click', target: 'window-1', ref: 'contact' })
  expect(clicked.isError).not.toBe(true)
  expect(clicked.structuredContent).toMatchObject({ status: 'observed', inputMode: 'background',
    actionResult: { effect: 'unverifiable' }, state: { elements_complete: false } })
  await execute({ action: 'type', target: 'window-1', ref: 'field-2', text: 'Continue after verified selection' })
  expect(desktop.value).toBe('Continue after verified selection')
  expect(desktop.calls.find(call => call.name === 'type_text')?.args.delivery_mode).toBe('background')
})

it('clears an earlier block when a later incomplete observation includes the changed control', async () => {
  const contact = { element_token: 'contact', role: 'AXCheckBox', label: 'Contacts', value: '0',
    frame: { x: 128, y: 140, w: 250, h: 50 } }
  desktop.extraElements = [contact]
  desktop.elementsComplete = false
  desktop.call = async name => name === 'click' ? { content: [], structuredContent: {
    effect: 'unverifiable', route: 'accessibility', delivery: { mode: 'background' },
  } } : undefined
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  expect((await execute({ action: 'click', target: 'window-1', ref: 'contact' })).isError).toBe(true)
  desktop.extraElements = [{ ...contact, value: '1' }]
  expect((await execute({ action: 'observe', target: 'window-1' })).isError).not.toBe(true)
  await execute({ action: 'type', target: 'window-1', ref: 'field-3', text: 'Verified delayed selection' })
  expect(desktop.value).toBe('Verified delayed selection')
})

it.each(['unverifiable', 'partial', 'suspected_noop', 'confirmed'])('returns background click effect %s with fresh state and recovery when unconfirmed', async (effect) => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  const action = { effect, route: 'accessibility', delivery: { mode: 'background' }, summary: 'AXPress delivered.' }
  desktop.call = async name => name === 'click' ? { content: [], structuredContent: action } : undefined
  const result = await execute({ action: 'click', target: 'window-1', ref: 'field-1' })
  expect(result.structuredContent).toMatchObject({ status: 'observed', actionResult: action, inputMode: 'background',
    state: { elements: [{ element_token: 'field-2' }] } })
  if (effect === 'confirmed') expect(result.structuredContent).not.toHaveProperty('nextAction')
  else {
    expect(result.structuredContent?.nextAction).toContain('stop repeating input')
    expect(result.structuredContent?.nextAction).toContain('inputMode: foreground')
  }
  expect(desktop.calls.filter(call => call.name === 'click')).toHaveLength(1)
  expect(desktop.calls.find(call => call.name === 'click')?.args.delivery_mode).toBe('background')
})

it('renews an expired native ref only when the same visible control remains uniquely identifiable', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  now.mockReturnValue(40_000)
  await execute({ action: 'type', target: 'window-1', ref: 'field-1', text: 'hello' })
  expect(desktop.value).toBe('hello')
  expect(desktop.calls.find(call => call.name === 'type_text')?.args.element_token).toBe('field-2')
  expect(desktop.calls.filter(call => call.name === 'type_text')).toHaveLength(1)
})

it('sends no input when an expired native ref now identifies changed editor text', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  desktop.value = 'User edit'
  now.mockReturnValue(40_000)
  await expect(execute({ action: 'type', target: 'window-1', ref: 'field-1', text: 'overwrite', replace: true }))
    .rejects.toMatchObject({ code: 'OBSERVATION_CHANGED', effect: 'none' })
  expect(desktop.value).toBe('User edit')
  expect(desktop.calls.some(call => call.name === 'set_value')).toBe(false)
})

it.each([true, false])('sends no input when renewal has duplicate controls or an incomplete tree (complete=%s)', async (complete) => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  now.mockReturnValue(40_000)
  desktop.call = async name => name === 'get_window_state' ? { content: [], structuredContent: {
    window_bounds: desktop.windows[0]?.bounds, elements_complete: complete,
    elements: Array.from({ length: complete ? 2 : 1 }, (_, index) => ({ element_token: `replacement-${index}`,
      role: 'AXTextField', value: '', frame: { x: 128, y: 220, w: 500, h: 36 } })),
  } } : undefined
  await expect(execute({ action: 'type', target: 'window-1', ref: 'field-1', text: 'hello' }))
    .rejects.toMatchObject({ code: 'OBSERVATION_CHANGED', effect: 'none' })
  expect(desktop.calls.some(call => call.name === 'type_text')).toBe(false)
})

it('starts native observation age after a slow accessibility read completes', async () => {
  let now = 1000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  await execute({ action: 'list' })
  desktop.call = async (name) => { if (name === 'get_window_state') now += 35_000; return undefined }
  await execute({ action: 'observe', target: 'window-1' })
  await execute({ action: 'type', target: 'window-1', ref: 'field-1', text: 'hello' })
  expect(desktop.value).toBe('hello')
  expect(desktop.calls.find(call => call.name === 'type_text')?.args.element_token).toBe('field-1')
})

it.each([{ count: 10, repeats: 8 }, { count: 1, repeats: 1000 }])('bounds complete native text with $count controls and refuses omitted refs', async ({ count, repeats }) => {
  await runtime.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000), Config({
    inputMode: 'background', showOverlay: false, screenshots: false, maxSnapshotChars: 900,
  }))
  await execute({ action: 'list' })
  desktop.call = async name => name === 'get_window_state' ? { content: [], structuredContent: {
    window_bounds: desktop.windows[0]?.bounds, tree_markdown: 'Duplicate tree'.repeat(1000), _note: 'Driver internals',
    elements: Array.from({ length: count }, (_, index) => ({ element_token: `button-${index}`, role: 'AXButton',
      label: '中文按钮'.repeat(repeats), frame: { x: 110, y: 120 + index * 10, w: 40, h: 10 } })),
  } } : undefined
  const result = await execute({ action: 'observe', target: 'window-1' })
  expect(JSON.stringify(result.structuredContent).length).toBeLessThanOrEqual(900)
  expect(result.structuredContent?.state).toMatchObject({ elements_complete: false })
  expect(JSON.stringify(result.structuredContent)).not.toContain('Duplicate tree')
  expect(JSON.stringify(result.structuredContent)).not.toContain('Driver internals')
  await expect(execute({ action: 'click', target: 'window-1', ref: `button-${count - 1}` }))
    .rejects.toMatchObject({ code: 'STALE_REF', effect: 'none' })
  expect(desktop.calls.some(call => call.name === 'click')).toBe(false)
})

it('admits the exact complete native text limit and clips controls one character below it', async () => {
  await runtime.close()
  const config = Config({ showOverlay: false, screenshots: false })
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000), config)
  await execute({ action: 'list' })
  const first = await execute({ action: 'observe', target: 'window-1' })
  config.maxSnapshotChars = JSON.stringify(first.structuredContent).length
  const exact = await execute({ action: 'observe', target: 'window-1' })
  expect(JSON.stringify(exact.structuredContent).length).toBe(config.maxSnapshotChars)
  expect(exact.structuredContent?.state).toMatchObject({ elements_complete: true })
  config.maxSnapshotChars--
  const clipped = await execute({ action: 'observe', target: 'window-1' })
  expect(JSON.stringify(clipped.structuredContent).length).toBeLessThanOrEqual(config.maxSnapshotChars)
  expect(clipped.structuredContent?.state).toMatchObject({ elements_complete: false, omitted_elements: 1 })
})

it.each(['missing-ref', 'missing-geometry', 'incomplete-tree'])('requires a model observation when an expired ref cannot renew: %s', async (reason) => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
  await execute({ action: 'list' })
  desktop.call = async name => name === 'get_window_state' ? { content: [], structuredContent: {
    window_bounds: desktop.windows[0]?.bounds, elements_complete: reason !== 'incomplete-tree',
    elements: [{ element_token: 'field', role: 'AXTextField', value: '',
      ...reason === 'missing-geometry' ? {} : { frame: { x: 128, y: 220, w: 500, h: 36 } } }],
  } } : undefined
  await execute({ action: 'observe', target: 'window-1' })
  now.mockReturnValue(40_000)
  await expect(execute({ action: 'type', target: 'window-1', ref: reason === 'missing-ref' ? 'absent' : 'field', text: 'hello' }))
    .rejects.toMatchObject({ code: 'OBSERVATION_REQUIRED', effect: 'none' })
  expect(desktop.calls.some(call => call.name === 'type_text')).toBe(false)
})

it('reports a native result budget too small for required metadata', async () => {
  await runtime.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000), Config({ showOverlay: false, maxSnapshotChars: 1 }))
  await execute({ action: 'list' })
  await expect(execute({ action: 'observe', target: 'window-1' })).rejects.toMatchObject({ code: 'SNAPSHOT_LIMIT_TOO_SMALL', effect: 'none' })
})

it('discovers a requested app when another window has unknown Space visibility', async () => {
  desktop.call = async name => ({ content: [], structuredContent: name === 'list_windows' ? { windows: [
    ...desktop.windows,
    { pid: 11, window_id: 12, app_name: 'Other app', is_on_screen: null, on_current_space: null },
  ] } : {} })
  expect((await execute({ action: 'list', query: 'Fixture' })).structuredContent?.targets).toEqual([
    { target: 'window-1', kind: 'window', app: 'Fixture', title: 'Computer fixture', pid: 9, windowId: 7 },
  ])
})

it('requires an observation and a current element ref, then reads the changed external field', async () => {
  await execute({ action: 'list' })
  await expect(execute({ action: 'type', target: 'window-1', ref: 'field-1', text: 'hello' }))
    .rejects.toMatchObject({ code: 'OBSERVATION_REQUIRED', effect: 'none' })
  await execute({ action: 'observe', target: 'window-1' })
  const result = await execute({ action: 'type', target: 'window-1', ref: 'field-1', text: 'hello' })
  expect(desktop.value).toBe('hello')
  expect(result.structuredContent).toMatchObject({ status: 'observed', state: { elements: [{ value: 'hello', element_token: 'field-2' }] } })
  await expect(execute({ action: 'click', target: 'window-1', ref: 'field-1' }))
    .rejects.toMatchObject({ code: 'STALE_REF', effect: 'none' })
  expect(desktop.calls.filter(call => call.name === 'click')).toEqual([])
})

it('requires a screenshot for coordinate scrolling and rejects mixed addressing', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  await expect(execute({ action: 'scroll', target: 'window-1', x: 0, y: 0, direction: 'down', amount: 1 })).rejects.toMatchObject({ code: 'SCREENSHOT_REQUIRED' })
  await execute({ action: 'observe', target: 'window-1', screenshot: true })
  await expect(execute({ action: 'click', target: 'window-1', ref: 'field-2', x: 0, y: 0 }))
    .rejects.toMatchObject({ code: 'AMBIGUOUS_ADDRESS' })
  await execute({ action: 'observe', target: 'window-1', screenshot: true })
  await execute({ action: 'scroll', target: 'window-1', x: 0, y: 0, direction: 'down', amount: 1 })
  expect(desktop.calls.find(call => call.name === 'scroll')?.args).toMatchObject({ pid: 9, window_id: 7, x: 0, y: 0, delivery_mode: 'background' })
})

it.each(['click', 'type'] as const)('refuses activating native pixel %s before dispatch in background mode', async (action) => {
  await execute({ action: 'list' })
  await expect(execute({ action, target: 'window-1', x: 0, y: 0, text: 'Must stay background' }))
    .rejects.toMatchObject({ code: 'BACKGROUND_PIXEL_UNAVAILABLE', effect: 'none' })
  await execute({ action: 'observe', target: 'window-1', screenshot: true })
  await expect(execute({ action, target: 'window-1', x: 0, y: 0, text: 'Must stay background' }))
    .rejects.toMatchObject({ code: 'BACKGROUND_PIXEL_UNAVAILABLE', effect: 'none' })
  expect(desktop.calls.some(call => ['click', 'type_text', 'set_value', 'hotkey'].includes(call.name))).toBe(false)
})

it('recovers expired coordinate scrolling by requesting a new screenshot before dispatch', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1', screenshot: true })
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_001)
  const expired = execute({ action: 'scroll', target: 'window-1', x: 0, y: 0, direction: 'down', amount: 1 })
  await expect(expired).rejects.toMatchObject({ code: 'OBSERVATION_REQUIRED', effect: 'none' })
  await expect(expired).rejects.toHaveProperty('nextAction', expect.stringContaining('{"action":"observe","target":"window-1","screenshot":true}'))
  expect(desktop.calls.some(call => call.name === 'scroll')).toBe(false)
  await execute({ action: 'observe', target: 'window-1', screenshot: true })
  await execute({ action: 'scroll', target: 'window-1', x: 0, y: 0, direction: 'down', amount: 1 })
  expect(desktop.calls.filter(call => call.name === 'scroll')).toHaveLength(1)
})

it('requires the current editor address for background typing after a successful click', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  await execute({ action: 'click', target: 'window-1', ref: 'field-1' })
  const missingAddress = execute({ action: 'type', target: 'window-1', text: 'Search text' })
  await expect(missingAddress).rejects.toMatchObject({ code: 'REF_REQUIRED', effect: 'none' })
  await expect(missingAddress).rejects.toHaveProperty('nextAction', expect.stringContaining('on every call'))
  expect(desktop.value).toBe('')
  await execute({ action: 'type', target: 'window-1', ref: 'field-2', text: 'Search text' })
  expect(desktop.value).toBe('Search text')
})

it('keeps targets inside their exact Agent activation and forgets vanished windows', async () => {
  await expect(execute({ action: 'observe', target: 'window-1' })).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' })
  await execute({ action: 'list' })
  desktop.windows = []
  expect((await execute({ action: 'list' })).structuredContent?.targets).toEqual([])
  await expect(execute({ action: 'observe', target: 'window-1' })).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' })
})

it('does not replay an input when the read after it fails', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  desktop.call = async (name) => {
    if (name === 'get_window_state') throw new Error('window disappeared')
    return { content: [{ type: 'text', text: 'input delivered' }] }
  }
  await expect(execute({ action: 'click', target: 'window-1', ref: 'field-1' }))
    .rejects.toMatchObject({ code: 'OBSERVATION_FAILED', effect: 'completed' })
  expect(desktop.calls.filter(call => call.name === 'click')).toHaveLength(1)
  await expect(execute({ action: 'click', target: 'window-1', ref: 'field-1' })).rejects.toMatchObject({ code: 'OBSERVATION_REQUIRED' })
})

it('surfaces an upstream structured refusal even when it omits isError', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  desktop.call = async () => ({ content: [{ type: 'text', text: 'denied' }], structuredContent: { status: 'refused', refusal: { code: 'permission_required', message: 'Accessibility permission is missing.' } } })
  await expect(execute({ action: 'type', target: 'window-1', ref: 'field-1', text: 'hello' }))
    .rejects.toMatchObject({ code: 'permission_required', effect: 'none' })
  expect(desktop.value).toBe('')
})

it('starts a different native lifecycle session after reset and never reuses a handle', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  const first = desktop.calls.find(call => call.name === 'get_window_state')?.args.session
  await execute({ action: 'reset' })
  await expect(execute({ action: 'observe', target: 'window-1' })).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' })
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-2' })
  const snapshots = desktop.calls.filter(call => call.name === 'get_window_state')
  expect(snapshots[1]?.args.session).not.toBe(first)
})

it('rejects executable URLs before acquiring a browser', async () => {
  await expect(execute({ action: 'open_browser', url: 'javascript:alert(1)' }))
    .rejects.toMatchObject({ code: 'INVALID_URL', effect: 'none' })
  await expect(execute({ action: 'open_browser', url: 'relative' })).rejects.toMatchObject({ code: 'INVALID_URL' })
})

it('serializes native operations across Sessions and cancels queued input before dispatch', async () => {
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const driver = new CuaDriver()
  const calls = new NativeCalls(driver, 10_000)
  desktop.call = async (name) => {
    if (name === 'get_window_state') { entered.resolve(undefined); await release.promise }
    return { content: [{ type: 'text', text: name }] }
  }
  const first = calls.call('get_window_state', {}, signal)
  await entered.promise
  const cancel = new AbortController()
  const second = calls.call('click', {}, cancel.signal)
  const canceled = expect(second).rejects.toThrow('canceled while queued')
  cancel.abort(new Error('canceled while queued'))
  expect(desktop.calls.map(call => call.name)).toEqual(['get_window_state'])
  release.resolve(undefined)
  await first
  await canceled
  expect(desktop.calls.map(call => call.name)).toEqual(['get_window_state'])
})

it('routes native text replacement, shortcuts, scrolling, dragging, and menus to the selected window', async () => {
  await execute({ action: 'open_app', bundleId: 'ai.neurix.fixture' })
  await execute({ action: 'observe', target: 'window-1' })
  await execute({ action: 'type', target: 'window-1', ref: 'field-1', text: 'replaced', replace: true })
  expect(desktop.value).toBe('replaced')
  await execute({ action: 'key', target: 'window-1', keys: ['cmd', 'a'] })
  await execute({ action: 'scroll', target: 'window-1', ref: 'field-3', direction: 'down', amount: 5 })
  await execute({ action: 'observe', target: 'window-1', screenshot: true })
  await expect(execute({ action: 'drag', target: 'window-1', x: 0, y: 1, toX: 2, toY: 3 }))
    .rejects.toMatchObject({ code: 'BACKGROUND_UNAVAILABLE' })
  await execute({ action: 'menu', target: 'window-1', path: ['File', 'Save'] })
  for (const name of ['set_value', 'hotkey', 'scroll', 'invoke_menu']) {
    expect(desktop.calls.find(call => call.name === name)?.args).toMatchObject({ pid: 9, window_id: 7 })
  }
})

it('allows application startup beyond the input deadline and reuses returned windows without another scan', async () => {
  vi.useFakeTimers()
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController()
    setTimeout(() => { controller.abort(new DOMException('Native deadline expired', 'TimeoutError')) }, ms)
    return controller.signal
  })
  const entered = Promise.withResolvers<undefined>()
  desktop.call = (_name, _args, active) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { resolve({ content: [], structuredContent: { windows: desktop.windows } }) }, 24_700)
    active?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('A Rust future was aborted')) }, { once: true })
    entered.resolve(undefined)
  })
  const opening = execute({ action: 'open_app', bundleId: 'ai.neurix.fixture' })
  const result = expect(opening).resolves.toMatchObject({ structuredContent: { status: 'opened', targets: [{ target: 'window-1', pid: 9 }], truncated: false } })
  await entered.promise
  await vi.advanceTimersByTimeAsync(24_700)
  await result
  expect(desktop.calls.map(call => call.name)).toEqual(['launch_app'])
})

it('reports startup timeout with uncertain effects and dispatches the launch only once', async () => {
  vi.useFakeTimers()
  const entered = Promise.withResolvers<undefined>()
  desktop.call = (_name, _args, active) => new Promise((_resolve, reject) => {
    active?.addEventListener('abort', () => { reject(new Error('A Rust future was aborted')) }, { once: true })
    entered.resolve(undefined)
  })
  const result = expect(execute({ action: 'open_app', bundleId: 'ai.neurix.fixture' })).rejects.toMatchObject({
    code: 'TIMEOUT', message: 'launch_app: open_app exceeded 30000ms', effect: 'possible',
  })
  await entered.promise
  await vi.advanceTimersByTimeAsync(30_000)
  await result
  expect(desktop.calls.map(call => call.name)).toEqual(['launch_app'])
})

it('retains other application targets when a launch has no window yet and reports malformed launch observations', async () => {
  await execute({ action: 'list' })
  desktop.windows = []
  expect((await execute({ action: 'open_app', bundleId: 'ai.neurix.fixture' })).structuredContent).toMatchObject({ status: 'opened', targets: [], launch: { launch_state: { window_ready: false } } })
  await execute({ action: 'observe', target: 'window-1' })
  desktop.call = () => Promise.resolve({ content: [], structuredContent: { status: 'launched' } })
  await expect(execute({ action: 'open_app', bundleId: 'ai.neurix.fixture' }))
    .rejects.toMatchObject({ code: 'OBSERVATION_FAILED', effect: 'completed', nextAction: 'List targets to discover the launched application. Do not repeat open_app automatically.' })
})

it('rejects missing native addresses, unsupported tab operations, and browser locators', async () => {
  await execute({ action: 'list' })
  for (const args of [
    { action: 'click' }, { action: 'scroll', direction: 'down', amount: 2 },
    { action: 'type', text: 'text', x: 1, y: 1, replace: true },
    { action: 'click', locator: { by: 'text', text: 'Save' } },
    { action: 'navigate', url: 'https://example.com' }, { action: 'dialog', accept: false },
  ]) {
    await execute({ action: 'observe', target: 'window-1', screenshot: true })
    await expect(execute({ ...args, target: 'window-1' })).rejects.toMatchObject({ effect: 'none' })
  }
  await expect(execute({ action: 'new_tab', target: 'window-1' })).rejects.toMatchObject({ code: 'TAB_REQUIRED' })
})

it('keeps exact window ids while refreshing titles and honors configured discovery limits', async () => {
  await execute({ action: 'list' })
  desktop.windows[0] = { pid: 9, window_id: 7, app_name: 'Renamed', title: 'New title' }
  expect((await execute({ action: 'list', query: 'New title' })).structuredContent?.targets)
    .toMatchObject([{ target: 'window-1', title: 'New title' }])
  desktop.windows = [{ pid: 9, window_id: 7 }]
  expect((await execute({ action: 'list' })).structuredContent?.targets).toMatchObject([{ target: 'window-1', title: '', app: '' }])
  desktop.windows = [{ pid: 1, window_id: 1 }, { pid: 2, window_id: 2 }]
  const limited = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000),
    Config({ inputMode: 'background', showOverlay: false, screenshots: false, maxTargets: 1 }))
  try {
    expect((await limited.execute(computerInput.parse({ action: 'list' }), signal)).structuredContent).toMatchObject({ truncated: true, targets: [{ title: '', app: '' }] })
  } finally { await limited.close() }
})

it('requires a new observation after its configured age and before another input', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  const now = Date.now()
  const original = Date.now
  Date.now = () => now + 30_001
  try { await expect(execute({ action: 'key', target: 'window-1', keys: ['Enter'] }))
    .rejects.toMatchObject({ code: 'OBSERVATION_REQUIRED' }) }
  finally { Date.now = original }
})

it('treats driver isError results as declared failures instead of success', async () => {
  desktop.call = () => Promise.resolve({ isError: true, content: [{ type: 'image', data: '', mimeType: 'image/png' }, { type: 'text', text: 'Driver unavailable' }] })
  await expect(execute({ action: 'list' })).rejects.toMatchObject({ code: 'DRIVER_REFUSED', message: 'Driver unavailable' })
})

it('does not invent element refs when the external snapshot contains only non-actionable nodes', async () => {
  await execute({ action: 'list' })
  desktop.call = () => Promise.resolve({ content: [{ type: 'text', text: 'Read only' }], structuredContent: { elements: [{ role: 'AXStaticText' }] } })
  await execute({ action: 'observe', target: 'window-1' })
  await expect(execute({ action: 'click', target: 'window-1', ref: 'not-actionable' })).rejects.toMatchObject({ code: 'STALE_REF' })
  desktop.call = () => Promise.resolve({ content: [{ type: 'text', text: 'No elements available' }], structuredContent: {} })
  await execute({ action: 'observe', target: 'window-1' })
})

it('rejects partial coordinate addresses and reports non-Error native failures visibly', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  await expect(execute({ action: 'click', target: 'window-1', ref: 'field-1', y: 1 })).rejects.toMatchObject({ code: 'AMBIGUOUS_ADDRESS' })
  await execute({ action: 'observe', target: 'window-1' })
  desktop.call = () => {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- native bindings can reject with a non-Error value.
    return Promise.reject('native input failed')
  }
  const failed = execute({ action: 'key', target: 'window-1', keys: ['Enter'] })
  await expect(failed).rejects.toMatchObject({ code: 'ACTION_FAILED' })
  await expect(failed).rejects.toThrow('native input failed')
})


it('captures only the selected window without replacing actionable refs or capture coordinates', async () => {
  expect(await runtime.capturePreview(signal)).toEqual({ kind: 'idle' })
  expect(desktop.calls).toHaveLength(0)
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1', screenshot: true })
  await execute({ action: 'move', target: 'window-1', ref: 'field-1' })
  const snapshots = desktop.snapshots
  const preview = await runtime.capturePreview(signal)
  expect(preview).toMatchObject({ kind: 'frame', imageUrl: `data:image/png;base64,${screenshotBase64}`, active: false })
  expect(desktop.snapshots).toBe(snapshots)
  expect(desktop.calls.at(-1)).toMatchObject({ name: 'get_window_state', args: {
    pid: 9, window_id: 7, display_only: true, include_accessibility_tree: false, include_screenshot: true, max_dimension: 640,
  } })
  await execute({ action: 'type', target: 'window-1', ref: `field-${snapshots}`, text: 'preview preserves refs' })
  expect(desktop.value).toBe('preview preserves refs')
  desktop.windows = []
  await execute({ action: 'list' })
  expect(await runtime.capturePreview(signal)).toEqual({ kind: 'idle' })
})

it('contains display-only capture failures and image limits without closing the target or invalidating input', async () => {
  await runtime.close()
  runtime = new ComputerRuntime(new NativeCalls(new CuaDriver(), 10_000),
    Config({ inputMode: 'background', showOverlay: false, screenshots: false, previewMaxBytes: 1024 }))
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  desktop.call = async name => name === 'get_window_state'
    ? { content: [{ type: 'image', mimeType: 'image/png', data: Buffer.alloc(2048).toString('base64') }] } : { content: [] }
  expect(await runtime.capturePreview(signal)).toMatchObject({ kind: 'unavailable', code: 'IMAGE_TOO_LARGE' })
  desktop.call = async (name) => {
    if (name === 'get_window_state') throw new Error('preview capture failed')
    return { content: [] }
  }
  expect(await runtime.capturePreview(signal)).toMatchObject({ kind: 'unavailable', code: 'CAPTURE_FAILED' })
  await expect(runtime.capturePreview(AbortSignal.abort(new Error('viewer closed')))).rejects.toThrow('viewer closed')
  desktop.call = undefined
  await execute({ action: 'type', target: 'window-1', ref: 'field-1', text: 'still open' })
  expect(desktop.value).toBe('still open')
  expect(desktop.calls.filter(call => call.name === 'end_session')).toHaveLength(0)
})

it('reports preview permission refusals and capture deadlines without replacing actionable refs', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  desktop.call = async name => name === 'get_window_state'
    ? { content: [], structuredContent: { refusal: { code: 'permission_required', message: 'Screen Recording is required.' } } }
    : { content: [] }
  expect(await runtime.capturePreview(signal)).toMatchObject({ kind: 'unavailable', code: 'PERMISSION_REQUIRED' })
  desktop.call = undefined
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new DOMException('Capture deadline', 'TimeoutError')))
  try {
    expect(await runtime.capturePreview(signal)).toMatchObject({ kind: 'unavailable', code: 'CAPTURE_TIMEOUT' })
  } finally { timeout.mockRestore() }
  await execute({ action: 'type', target: 'window-1', ref: 'field-1', text: 'preserved' })
  expect(desktop.value).toBe('preserved')
})

it('keeps preview reads independent of the actionable native lifecycle and its refs', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  const previousSession = desktop.calls.find(call => call.name === 'start_session')?.args.session
  desktop.call = async (name, args) => {
    if (name === 'start_session' && args.session === previousSession) {
      return { content: [], structuredContent: { refusal: { code: 'session_ended', message: 'Native session expired.' } } }
    }
    if (name === 'get_window_state') return { content: [{ type: 'image', mimeType: 'image/png', data: screenshotBase64 }] }
    return { content: [] }
  }
  expect(await runtime.capturePreview(signal)).toMatchObject({ kind: 'frame' })
  const read = desktop.calls.filter(call => call.name === 'get_window_state').at(-1)
  expect(read?.args).toMatchObject({ session: previousSession, display_only: true })
  expect(desktop.calls.filter(call => call.name === 'start_session')).toHaveLength(1)
  desktop.call = undefined
  await execute({ action: 'type', target: 'window-1', ref: 'field-1', text: 'preserved after preview' })
  expect(desktop.value).toBe('preserved after preview')
})

it('allows native preview startup within the operation budget and applies the shorter deadline to warm captures', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  vi.useFakeTimers()
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController()
    setTimeout(() => { controller.abort(new DOMException('Capture deadline', 'TimeoutError')) }, ms)
    return controller.signal
  })
  const entered = Promise.withResolvers<undefined>()
  desktop.call = (name, _args, active) => {
    if (name !== 'get_window_state') return Promise.resolve(undefined)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { resolve({ content: [{ type: 'image', mimeType: 'image/png', data: screenshotBase64 }] }) }, 4000)
      active?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Native capture interrupted')) }, { once: true })
      entered.resolve(undefined)
    })
  }
  const first = runtime.capturePreview(signal)
  await entered.promise
  await vi.advanceTimersByTimeAsync(4000)
  await expect(first).resolves.toMatchObject({ kind: 'frame' })
  const next = runtime.capturePreview(signal)
  await vi.advanceTimersByTimeAsync(2500)
  await expect(next).resolves.toMatchObject({ kind: 'unavailable', code: 'CAPTURE_TIMEOUT' })
})

it('renews an expired native session before input and requires a new observation instead of dispatching an old ref', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  const previousSession = desktop.calls.find(call => call.name === 'start_session')?.args.session
  desktop.call = async (name, args) => name === 'start_session' && args.session === previousSession
    ? { content: [], structuredContent: { refusal: { code: 'session_ended', message: 'Native session expired.' } } }
    : { content: [] }
  await expect(execute({ action: 'type', target: 'window-1', ref: 'field-1', text: 'do not dispatch' }))
    .rejects.toMatchObject({ code: 'OBSERVATION_REQUIRED', effect: 'none' })
  expect(desktop.calls.filter(call => call.name === 'start_session').at(-1)?.args.session).not.toBe(previousSession)
  expect(desktop.calls.some(call => ['set_value', 'type_text', 'bring_to_front'].includes(call.name))).toBe(false)
})

it('reports a structured user stop as canceled input without exposing an object coercion', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  const entered = Promise.withResolvers<undefined>(), stopped = new AbortController()
  desktop.call = async (name, _args, active) => {
    if (name === 'click') {
      entered.resolve(undefined)
      await new Promise((_resolve, reject) => active?.addEventListener('abort', () => {
        reject(new Error('Native input interrupted'))
      }, { once: true }))
    }
    return { content: [] }
  }
  const clicked = runtime.execute(computerInput.parse({ action: 'click', target: 'window-1', ref: 'field-1' }), stopped.signal)
  const canceled = expect(clicked).rejects.toMatchObject({ code: 'CANCELED', effect: 'possible',
    message: 'click: Computer input was canceled.' })
  await entered.promise
  stopped.abort({ kind: 'user' })
  await canceled
})


it('captures fresh pixels during native input without queuing behind it or changing actionable snapshots', async () => {
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  const first = await runtime.capturePreview(signal)
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  desktop.call = async (name) => {
    if (name === 'click') { entered.resolve(undefined); await release.promise }
    if (name === 'get_window_state') return { content: [{ type: 'image', mimeType: 'image/png', data: screenshotBase64 }] }
    return { content: [] }
  }
  const click = execute({ action: 'click', target: 'window-1', ref: 'field-1' })
  try {
    await entered.promise
    const count = desktop.calls.length
    const preview = await runtime.capturePreview(signal)
    expect(preview).toMatchObject({ kind: 'frame', action: 'click', active: true })
    if (preview.kind !== 'frame' || first.kind !== 'frame') throw new Error('Missing image preview')
    expect(preview.capturedAt).toBeGreaterThanOrEqual(first.capturedAt)
    expect(desktop.calls).toHaveLength(count + 1)
    expect(desktop.calls.at(-1)).toMatchObject({ name: 'get_window_state', args: {
      pid: 9, window_id: 7, display_only: true, include_accessibility_tree: false,
    } })
  } finally { desktop.call = undefined; release.resolve(undefined); await click }
})
