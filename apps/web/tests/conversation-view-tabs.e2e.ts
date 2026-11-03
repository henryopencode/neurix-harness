/** Conversation view buttons retain compact spacing, hit targets, and hover feedback. */
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = createChatScrollFixture({
  markerPrefix: 'VIEW_TABS',
  title: 'VIEW_TABS short session',
  turns: 4,
})
const SEED_ID = 'conversation-view-tabs-web-e2e'

/** Label and button rectangles of one tab, and which element owns each probe point. */
interface TabProbe {
  readonly label: { left: number; top: number; right: number; bottom: number }
  readonly button: { left: number; top: number; right: number; bottom: number }
  readonly headerHeight: number
  readonly titleBottom: number
  readonly titleLeft: number
  readonly ownsTopPadding: boolean
  readonly ownsInlinePadding: boolean
}

/**
 * Measure one tab's press target and its clearance from the Session title.
 * @param page - the page under test.
 * @param name - the tab's accessible name.
 * @returns the tab's rectangles and probe owners.
 */
async function probeTab(page: Page, name: string): Promise<TabProbe> {
  return page.getByRole('tab', { name, exact: true }).evaluate((tab) => {
    const range = document.createRange()
    range.selectNodeContents(tab)
    const label = range.getBoundingClientRect()
    const button = tab.getBoundingClientRect()
    const header = tab.closest('header')!
    const title = header.querySelector('nav')!.getBoundingClientRect()
    const owns = (x: number, y: number): boolean => document.elementFromPoint(x, y)?.closest('[role="tab"]') === tab
    const centerX = (label.left + label.right) / 2
    return {
      label: { left: label.left, top: label.top, right: label.right, bottom: label.bottom },
      button: { left: button.left, top: button.top, right: button.right, bottom: button.bottom },
      headerHeight: header.getBoundingClientRect().height,
      titleBottom: title.bottom,
      titleLeft: title.left,
      ownsTopPadding: owns(centerX, button.top + 2),
      ownsInlinePadding: owns(button.left + 2, (label.top + label.bottom) / 2),
    }
  })
}

async function openSeededSession(page: Page): Promise<void> {
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  await page.getByRole('textbox', { name: 'Search session names', exact: true }).fill(FIXTURE.markers.user(1))
  const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  const deadline = Date.now() + 60_000
  while (await results.count() !== 1) {
    if (Date.now() > deadline) throw new Error('seeded session never appeared in the sidebar search results')
    await page.waitForTimeout(200)
  }
  await results.click()
}

describe('web e2e: conversation view tabs', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, FIXTURE.log, SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 900)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openSeededSession(page)
    await page.getByText(FIXTURE.markers.assistant(FIXTURE.turns), { exact: false }).last()
      .waitFor({ timeout: 30_000 })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('aligns compact buttons below the title without making the header taller', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-conversation-view-tabs-target'))
    const chat = await probeTab(page, 'Chat')
    const trajectory = await probeTab(page, 'Trajectory')
    const more = (await page.getByRole('button', { name: 'More conversation views', exact: true }).boundingBox())!
    expect(chat.headerHeight).toBe(84)
    expect(chat.button.bottom - chat.button.top).toBe(28)
    expect(chat.button.left).toBe(chat.titleLeft)
    expect(chat.button.top - chat.titleBottom).toBeGreaterThanOrEqual(6)
    expect(chat.button.top - chat.titleBottom).toBeLessThanOrEqual(10)
    expect(trajectory.button.top).toBe(chat.button.top)
    expect(trajectory.button.bottom).toBe(chat.button.bottom)
    expect(more.y).toBe(chat.button.top)
    expect(more.height).toBe(28)
    expect(chat.ownsTopPadding).toBe(true)
    expect(chat.ownsInlinePadding).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps the Trajectory toolbar below the view buttons', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-conversation-view-tabs-trajectory'))
    await page.getByRole('tab', { name: 'Trajectory', exact: true }).click()
    const toolbar = page.getByRole('toolbar', { name: 'Trajectory toolbar' })
    await toolbar.waitFor({ timeout: 30_000 })
    const trajectory = await probeTab(page, 'Trajectory')
    expect((await toolbar.boundingBox())!.y).toBeGreaterThan(trajectory.button.bottom)
    expect(await page.getByRole('tab', { name: 'Trajectory', exact: true }).getAttribute('aria-selected')).toBe('true')
    expect(tripwire.pageErrors).toEqual([])
  })

  it.each(['light', 'dark'] as const)('shows hover feedback without moving controls in %s mode', async (colorScheme) => {
    try {
      await page.emulateMedia({ colorScheme })
      await expect.poll(() => page.locator('body').evaluate(body => body.hasAttribute('data-ds-dark-theme')))
        .toBe(colorScheme === 'dark')
      const chat = page.getByRole('tab', { name: 'Chat', exact: true })
      const more = page.getByRole('button', { name: 'More conversation views', exact: true })
      for (const control of [chat, more]) {
        await page.mouse.move(0, 0)
        const before = await control.evaluate(element => getComputedStyle(element).backgroundColor)
        const rect = await control.boundingBox()
        await control.hover()
        await expect.poll(() => control.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(before)
        expect(await control.boundingBox()).toEqual(rect)
        await expect.poll(() => page.getByRole('tooltip').count()).toBe(control === more ? 1 : 0)
      }
      expect(tripwire.pageErrors).toEqual([])
    } finally {
      await page.mouse.move(0, 0)
      await page.emulateMedia({ colorScheme: null })
    }
  })
})
