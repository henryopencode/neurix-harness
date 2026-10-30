/** Real Web profile and footer slots with the external Electron preload substituted. */
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, expect, it, onTestFailed } from 'vitest'
import type { DesktopUpdatePresentation } from '../../desktop/src/ipc.ts'
import { launchWebScaffold, watchConsole, type WebScaffold, type WebConsoleTripwire } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

declare global {
  interface Window {
    __desktopUpdateFixture: { emit(state: DesktopUpdatePresentation): void; opens: number; stops: number }
  }
}

let scaffold: WebScaffold | undefined
let browser: Browser | undefined
let page: Page
let tripwire: WebConsoleTripwire
const evidence = fileURLToPath(new URL('../../../.playwright-mcp/update-control/', import.meta.url))

beforeAll(async () => {
  await mkdir(evidence, { recursive: true })
  scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)) })
  browser = await chromium.launch()
  page = await newEnglishPage(browser)
  await page.addInitScript(() => {
    let current: DesktopUpdatePresentation = { phase: 'available', version: '1.0.1' }
    const listeners = new Set<(state: DesktopUpdatePresentation) => void>()
    const fixture = { opens: 0, stops: 0, emit(state: DesktopUpdatePresentation) {
      current = state
      for (const listener of listeners) listener(state)
    } }
    const updates = {
      status: async () => current,
      subscribe: (listener: (state: DesktopUpdatePresentation) => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      open: async () => {
        fixture.opens++
        if (current.phase === 'available') fixture.emit({ phase: 'downloading', version: '1.0.1', percent: 37, canCancel: true })
      },
      cancel: async () => { fixture.stops++; fixture.emit({ phase: 'available', version: '1.0.1' }) },
    }
    Object.defineProperty(window, 'dshDesktop', { value: { protocolVersion: 1, updates } })
    window.__desktopUpdateFixture = fixture
  })
  tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
})

afterAll(async () => { try { await browser?.close() } finally { await scaffold?.close() } })

it('downloads, stops, retries, and offers the platform-specific installation action in the navigation rail', async () => {
  onTestFailed(() => saveFailureShot(page, 'desktop-update-footer'))
  await page.setViewportSize({ width: 1120, height: 820 })
  const footer = page.locator('[data-sidebar-footer]')
  const download = footer.getByRole('button', { name: 'Download update', exact: true })
  await download.waitFor()
  const bounds = await download.boundingBox()
  expect(bounds?.width).toBe(36)
  expect(bounds?.height).toBe(36)
  expect(await download.innerText()).toBe('')
  await expect(`${await footer.ariaSnapshot()}\n`).toMatchFileSnapshot('./expected/desktop-update/available.expected.md')
  await download.click()
  const stop = footer.getByRole('button', { name: 'Stop download', exact: true })
  await stop.waitFor()
  expect(await stop.getAttribute('aria-disabled')).toBe('false')
  expect(await footer.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('37')
  await page.emulateMedia({ colorScheme: 'dark' })
  await stop.hover()
  await page.getByRole('tooltip').waitFor()
  await page.screenshot({ path: evidence + '/progress-dark.png' })
  await expect(`${await footer.ariaSnapshot()}\n`).toMatchFileSnapshot('./expected/desktop-update/progress.expected.md')
  await stop.click()
  await download.waitFor()
  expect(await page.evaluate(() => window.__desktopUpdateFixture.stops)).toBe(1)
  await download.click()
  await stop.waitFor()
  await stop.focus()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('[data-sidebar-collapsed]').waitFor()
  expect(await stop.evaluate(element => element === document.activeElement)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: evidence + '/progress-narrow.png' })
  await page.evaluate(() => { window.__desktopUpdateFixture.emit({ phase: 'ready', version: '1.0.1', installMode: 'installer' }) })
  const open = footer.getByRole('button', { name: 'Open installer', exact: true })
  await open.waitFor()
  await open.click()
  expect(await page.evaluate(() => window.__desktopUpdateFixture.opens)).toBe(3)
  await page.evaluate(() => { window.__desktopUpdateFixture.emit({ phase: 'ready', version: '1.0.1', installMode: 'restart' }) })
  await footer.getByRole('button', { name: 'Install and restart', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Home', exact: true }).focus()
  await page.mouse.move(200, 20)
  await footer.getByRole('tooltip').waitFor({ state: 'detached' })
  await expect(`${await footer.ariaSnapshot()}\n`).toMatchFileSnapshot('./expected/desktop-update/ready.expected.md')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.screenshot({ path: evidence + '/ready-light.png' })
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
})
