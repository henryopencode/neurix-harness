/** DOM rectangles determine physical endpoints; focused selections and scroll ownership remain intact. */

import { chromium, type Browser, type Page } from 'playwright'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Config } from '../src/index.ts'
import { foregroundBrowserTarget } from '../src/foreground-browser.ts'
import { computerInput } from '../src/schema.ts'
import { browserFixture, resetBrowser } from './fixtures/browser.ts'

vi.mock('playwright', async () => ({ chromium: { launch: (await import('./fixtures/browser.ts')).launch } }))
const wheel = vi.hoisted(() => vi.fn())
vi.mock('../src/browser-scroll.ts', () => ({ scrollBrowserPage: wheel }))

type Input = Parameters<typeof foregroundBrowserTarget>[1]
let browser: Browser, page: Page
const signal = new AbortController().signal
const config = Config({ scrollDurationMs: 650 })
const window = { pid: 9, windowId: 7, bounds: { x: 100, y: 100, width: 1000, height: 700 },
  content: { x: 100, y: 180, width: 1000, height: 600 }, scaleX: 2, scaleY: 2, viewport: { width: 500, height: 300 } }
function request(value: Record<string, unknown>): Input {
  const input = computerInput.parse({ target: 'tab-1', ...value })
  switch (input.action) {
    case 'move': case 'click': case 'type': case 'key': case 'scroll': case 'drag': return input
    default: throw new Error('This fixture requires pointer or keyboard input')
  }
}
beforeEach(async () => {
  resetBrowser(); wheel.mockReset()
  browser = await chromium.launch()
  page = await (await browser.newContext()).newPage()
  browserFixture.locatorBounds['#source'] = { x: 40, y: 60, width: 100, height: 40 }
  browserFixture.locatorBounds['#destination'] = { x: 180, y: 120, width: 40, height: 60 }
})
afterEach(async () => { await browser.close() })

it('maps current CSS geometry through the measured native content rectangle without changing viewport metrics', async () => {
  const target = await foregroundBrowserTarget(page, request({ action: 'move' }), page.locator('#source'), undefined, window, config, signal)
  expect(target).toMatchObject({ owner: 'tab-1', pid: 9, windowId: 7, bounds: window.bounds, capture: window.content,
    scaleX: 2, scaleY: 2, point: { x: 280, y: 340 } })
  expect(browserFixture.calls.some(call => call.name === 'scrollIntoView')).toBe(true)
  expect(browserFixture.calls.some(call => call.name.includes('DeviceMetrics'))).toBe(false)
})

it('clips a partly visible source to the current viewport', async () => {
  browserFixture.locatorBounds['#source'] = { x: -20, y: -10, width: 40, height: 30 }
  const target = await foregroundBrowserTarget(page, request({ action: 'click' }), page.locator('#source'), undefined, window, config, signal)
  expect(target.point).toEqual({ x: 120, y: 200 })
})

it.each([null, { x: 600, y: 10, width: 40, height: 30 }])('refuses a source without a visible hit point: %j', async (bounds) => {
  browserFixture.locatorBounds['#source'] = bounds
  await expect(foregroundBrowserTarget(page, request({ action: 'click' }), page.locator('#source'), undefined, window, config, signal))
    .rejects.toMatchObject({ code: 'ELEMENT_NOT_VISIBLE', effect: 'none' })
})

it('preserves the already focused editor selection and rejects a readonly editor', async () => {
  browserFixture.focusedEditable = true
  const target = await foregroundBrowserTarget(page, request({ action: 'type', text: 'replacement' }), page.locator('#source'), undefined, window, config, signal)
  expect(target.point).toBeUndefined()
  browserFixture.focusedEditable = false
  expect((await foregroundBrowserTarget(page, request({ action: 'type', text: 'replacement' }), page.locator('#source'), undefined, window, config, signal)).point)
    .toEqual({ x: 280, y: 340 })
  browserFixture.locatorEditable = false
  await expect(foregroundBrowserTarget(page, request({ action: 'type', text: 'refused' }), page.locator('#source'), undefined, window, config, signal))
    .rejects.toMatchObject({ code: 'EDITABLE_FIELD_REQUIRED', effect: 'none' })
})

it('maps screenshot-grounded coordinates and leaves keyboard-only input without a fabricated mouse point', async () => {
  expect((await foregroundBrowserTarget(page, request({ action: 'move', x: 10, y: 20 }), undefined, undefined, window, config, signal)).point)
    .toEqual({ x: 120, y: 220 })
  expect((await foregroundBrowserTarget(page, request({ action: 'key', keys: ['left'] }), undefined, undefined, window, config, signal)).point)
    .toBeUndefined()
  await expect(foregroundBrowserTarget(page, request({ action: 'move', x: 500, y: 20 }), undefined, undefined, window, config, signal))
    .rejects.toMatchObject({ code: 'POINT_OUTSIDE_VIEWPORT', effect: 'none' })
})

it('uses the requested fraction inside a current drop locator, or explicit destination coordinates', async () => {
  const target = await foregroundBrowserTarget(page, request({ action: 'drag', toPosition: { x: 1, y: 1 } }),
    page.locator('#source'), page.locator('#destination'), window, config, signal)
  expect(target.destination).toEqual({ x: 540, y: 540 })
  expect((await foregroundBrowserTarget(page, request({ action: 'drag', toX: 100, toY: 200 }),
    page.locator('#source'), undefined, window, config, signal)).destination).toEqual({ x: 300, y: 580 })
  expect((await foregroundBrowserTarget(page, request({ action: 'drag' }), page.locator('#source'), undefined, window, config, signal)).destination)
    .toBeUndefined()
})

it('rejects ambiguous, hidden and offscreen destinations before any physical input', async () => {
  await expect(foregroundBrowserTarget(page, request({ action: 'drag', toX: 100, toY: 100 }),
    page.locator('#source'), page.locator('#destination'), window, config, signal)).rejects.toMatchObject({ code: 'AMBIGUOUS_ADDRESS' })
  browserFixture.locatorBounds['#destination'] = null
  await expect(foregroundBrowserTarget(page, request({ action: 'drag' }), page.locator('#source'), page.locator('#destination'), window, config, signal))
    .rejects.toMatchObject({ code: 'ELEMENT_NOT_VISIBLE' })
  await expect(foregroundBrowserTarget(page, request({ action: 'drag', toX: 100, toY: 400 }), page.locator('#source'), undefined, window, config, signal))
    .rejects.toMatchObject({ code: 'POINT_OUTSIDE_VIEWPORT' })
})

it('keeps browser scrolling in its continuous gesture engine without scrolling the locator into view', async () => {
  const input = request({ action: 'scroll', direction: 'down', amount: 420 })
  const target = await foregroundBrowserTarget(page, input, page.locator('#source'), undefined, window, config, signal)
  expect(browserFixture.calls.some(call => call.name === 'scrollIntoView')).toBe(false)
  await target.wheel?.()
  expect(wheel).toHaveBeenCalledWith(page, { x: 90, y: 80 }, input, 650, signal)
  expect((await foregroundBrowserTarget(page, input, undefined, undefined, window, config, signal)).wheel).toBeUndefined()
})
