/** Default-loaded entry controls activate through the real Web profile and Loader. */
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold, type WebConsoleTripwire } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

describe('default navigation entry customization', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page
  let tripwire: WebConsoleTripwire

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  })

  afterAll(async () => {
    try { await browser?.close() } finally { await scaffold?.close() }
  })

  it('separates the icon rail from browsing and retains navigation focus on narrow screens', async () => {
    onTestFailed(() => saveFailureShot(page, 'navigation-rail'))
    const home = page.getByRole('button', { name: 'Home', exact: true })
    const rail = page.locator('[data-sidebar-navigation]')
    const browsing = page.locator('[data-sidebar-browser]')
    const footer = page.locator('[data-sidebar-footer]')
    await home.waitFor()
    const railBox = await rail.boundingBox()
    const browserBox = await browsing.boundingBox()
    const footerBox = await footer.boundingBox()
    expect(railBox).not.toBeNull()
    expect(browserBox).not.toBeNull()
    expect(footerBox).not.toBeNull()
    expect(railBox!.width).toBe(56)
    expect(browserBox!.x).toBeGreaterThanOrEqual(railBox!.x + railBox!.width)
    expect(footerBox!.x).toBe(railBox!.x)
    expect(footerBox!.width).toBe(railBox!.width)
    expect(footerBox!.y).toBeGreaterThanOrEqual(railBox!.y + railBox!.height)
    const tasks = page.getByRole('button', { name: 'Automation tasks', exact: true })
    expect(await tasks.innerText()).toBe('')
    await tasks.focus()
    await page.getByRole('tooltip', { name: 'Automation tasks', exact: true }).waitFor()
    await tasks.press('Enter')
    await page.getByRole('heading', { name: 'Automation tasks', exact: true }).waitFor()
    await home.click()
    expect(await home.getAttribute('aria-current')).toBe('page')
    expect(await page.getByRole('heading', { name: 'Automation tasks', exact: true }).count()).toBe(0)
    const originalViewport = page.viewportSize()!
    try {
      await home.focus()
      await page.setViewportSize({ width: 390, height: 844 })
      await page.locator('[data-sidebar-collapsed]').waitFor()
      expect(await home.evaluate(element => document.activeElement === element)).toBe(true)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const homeBox = await home.boundingBox()
      expect(homeBox!.width).toBeCloseTo(36, 3)
      expect(homeBox!.x + homeBox!.width).toBeLessThanOrEqual(56)
    } finally {
      await page.setViewportSize(originalViewport)
      await page.locator('[data-sidebar-collapsed]').waitFor({ state: 'detached' })
    }
  })

  it('keeps the browser at its expanded width until the sidebar slide finishes and respects reduced motion', async () => {
    onTestFailed(() => saveFailureShot(page, 'sidebar-transition'))
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const samples = await page.evaluate(async () => {
      const browser = document.querySelector('[data-sidebar-browser]')
      const shell = browser?.parentElement
      const frame = browser?.closest<HTMLElement>('[style*="grid-template-columns"]')
      const toggle = document.querySelector<HTMLButtonElement>('button[aria-label="Collapse sidebar"]')
      if (shell === undefined || shell === null || frame === null || frame === undefined || toggle === null) {
        throw new Error('Sidebar transition controls are missing')
      }
      const rows: Array<{ width: number; frozen: boolean }> = []
      const start = performance.now()
      toggle.click()
      await new Promise<void>((resolve) => {
        const sample = () => {
          rows.push({ width: Number.parseFloat(getComputedStyle(frame).gridTemplateColumns), frozen: shell.style.width !== '' })
          if (performance.now() - start >= 420) resolve()
          else requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      return rows
    })
    const moving = samples.filter(sample => sample.width > 57 && sample.width < 260)
    expect(moving.length).toBeGreaterThan(0)
    expect(moving.every(sample => sample.frozen)).toBe(true)
    expect(samples.at(-1)?.width).toBeCloseTo(56, 0)
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
    await page.locator('[data-animating]').waitFor({ state: 'detached' })
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
      expect(await page.locator('[data-sidebar-browser]').evaluate(element => element.parentElement?.style.width)).toBe('')
      expect(await page.locator('[data-sidebar-browser]').evaluate((element) => {
        const frame = element.closest<HTMLElement>('[style*="grid-template-columns"]')
        return frame === null ? undefined : Number.parseFloat(getComputedStyle(frame).gridTemplateColumns)
      })).toBe(56)
    } finally {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
      await page.locator('[data-animating]').waitFor({ state: 'detached' })
    }
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps plugin browsing in its navigation entry and offers only creation in More after reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'entry-customization'))
    const nav = page.getByRole('navigation', { name: 'Global panels' })
    const tasks = nav.getByRole('button', { name: 'Automation tasks', exact: true })
    const more = nav.getByRole('button', { name: 'More', exact: true })
    await tasks.waitFor()
    await tasks.click()
    await page.getByRole('heading', { name: 'Automation tasks', exact: true }).waitFor()
    for (const reload of [false, true]) {
      if (reload) {
        await page.reload({ waitUntil: 'load' })
        await tasks.click()
        await page.getByRole('heading', { name: 'Automation tasks', exact: true }).waitFor()
      }
      await tasks.waitFor()
      await more.click()
      const menu = page.getByRole('menu')
      await menu.getByRole('menuitem', { name: 'Create your plugin', exact: true }).waitFor()
      expect(await menu.getByRole('menuitem').allTextContents()).toEqual(['Create your plugin'])
      await expect(`${await menu.ariaSnapshot()}\n`).toMatchFileSnapshot('./expected/entry-customization/sidebar-menu.expected.md')
      expect(await menu.getByRole('separator').count()).toBe(0)
      expect(await tasks.getAttribute('aria-current')).toBe('page')
      await page.keyboard.press('Escape')
      await menu.waitFor({ state: 'detached' })
      await nav.getByRole('button', { name: 'Plugins', exact: true }).click()
      expect(await nav.getByRole('button', { name: 'Plugins', exact: true }).getAttribute('aria-current')).toBe('page')
      await tasks.click()
      await page.getByRole('heading', { name: 'Automation tasks', exact: true }).waitFor()
    }
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
