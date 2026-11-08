/** Git branch metadata traverses the real Host, generated Remote, resources, and header slots. */
import { execFileSync } from 'node:child_process'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const fixture = createChatScrollFixture({ markerPrefix: 'GIT_BRANCH', title: 'GIT_BRANCH header context', turns: 1 })
let app: WebScaffold
let browser: Browser
let page: Page
let consoleState: ReturnType<typeof watchConsole>

function git(...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Branch test', '-c', 'user.email=branch@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd: app.workspaceCwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

beforeAll(async () => {
  app = await launchWebScaffold()
  await seedSession(app, fixture.log, 'git-branch-web-e2e')
  browser = await chromium.launch()
  page = await newEnglishPage(browser, 1200)
  consoleState = watchConsole(page)
  await page.goto(app.authenticatedUrl)
  const search = page.getByRole('button', { name: 'Search sessions' })
  try { await search.waitFor() } catch (error) {
    await saveFailureShot(page, 'git-branch-startup')
    console.error({ pageErrors: consoleState.pageErrors, body: await page.locator('body').innerText() })
    throw error
  }
  if (await search.getAttribute('aria-expanded') !== 'true') await search.click()
  await page.getByRole('textbox', { name: 'Search session names', exact: true }).fill(fixture.markers.user(1))
  const result = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  await result.first().waitFor({ timeout: 30_000 })
  expect(await result.count()).toBe(1)
  await result.first().click()
  await page.getByText(fixture.markers.assistant(1), { exact: false }).last().waitFor()
})

afterAll(async () => {
  try { await browser?.close() } finally { await app?.close() }
})

it('follows repository initialization and branch changes without changing the Session or reloading', async () => {
  expect(await page.getByRole('button', { name: /^Git branch:/u }).count()).toBe(0)
  git('init', '-q', '-b', 'main')
  const main = page.getByRole('button', { name: 'Git branch: main', exact: true })
  await main.waitFor({ timeout: 15_000 })
  await expect(`${await main.ariaSnapshot()}\n`).toMatchFileSnapshot('./expected/git-branch/badge.expected.md')
  const location = page.url()
  git('commit', '-q', '--allow-empty', '-m', 'initial')
  const longName = 'feature/a-long-branch-name-for-the-conversation-header'
  git('checkout', '-qb', longName)
  const badge = page.getByRole('button', { name: `Git branch: ${longName}`, exact: true })
  await badge.waitFor({ timeout: 15_000 })
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 900 })
      const box = await badge.boundingBox()
      expect(box?.width).toBeGreaterThan(24)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await badge.click()
      const tooltip = page.getByRole('tooltip')
      await tooltip.waitFor()
      expect(await tooltip.textContent()).toContain(longName)
      const tip = (await tooltip.boundingBox())!
      expect(tip.x).toBeGreaterThanOrEqual(0)
      expect(tip.x + tip.width).toBeLessThanOrEqual(width)
      await page.keyboard.press('Escape')
      await expect.poll(() => tooltip.count()).toBe(0)
    }
  }
  git('checkout', '-q', '--detach')
  await page.getByRole('button', { name: `Detached · ${git('rev-parse', '--short', 'HEAD')}`, exact: true }).waitFor({ timeout: 15_000 })
  expect(page.url()).toBe(location)
  expect(consoleState.pageErrors).toEqual([])
})
