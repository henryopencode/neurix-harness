/** Real Git branch switching through the shipped composer context and Remote service. */

import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const execute = promisify(execFile)
const mode = webSnapshotMode()
const expectedRoot = fileURLToPath(new URL('./expected/git-branch', import.meta.url))
const seed = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
const longBranch = 'feature/session-header-with-a-long-branch-name'

describe('web e2e: Session Git branches', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  const git = async (...args: string[]): Promise<string> => (await execute('git', args, {
    cwd: scaffold.workspaceCwd,
    env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined,
      GIT_CONFIG_COUNT: '0', GIT_CONFIG_PARAMETERS: '', GIT_CONFIG_GLOBAL: '', GIT_CONFIG_NOSYSTEM: '1' },
  })).stdout.trim()

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    await git('init', '-b', 'main')
    await git('config', 'user.name', 'Branch browser fixture')
    await git('config', 'user.email', 'branch-browser@example.invalid')
    await git('config', 'commit.gpgSign', 'false')
    await writeFile(join(scaffold.workspaceCwd, 'file.txt'), 'initial\n')
    await git('add', 'file.txt')
    await git('commit', '-m', 'initial')
    await git('branch', longBranch)
    await seedSession(scaffold, await readFile(seed, 'utf8'), 'git-branch-ui')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
  })

  afterAll(async () => {
    try { await browser?.close() }
    finally { await scaffold?.close() }
  })

  it('shows the branch, switches safely, and fits a 390px viewport in both themes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-git-branch'))
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const group = page.getByRole('treeitem').first()
    await group.waitFor()
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
    await page.getByRole('treeitem').nth(1).click()
    const trigger = page.getByRole('button', { name: 'Switch Git branch: main', exact: true })
    await trigger.waitFor()
    expect(await page.locator('[data-slot="conversation.session.header.utilities"]').getByRole('button', { name: 'Switch Git branch: main', exact: true }).count()).toBe(0)
    const directoryContext = page.locator('[data-git-branch-context]')
    const editor = page.locator('[data-slot="conversation.composer.bar"] [contenteditable]')
    const contextBox = await directoryContext.boundingBox()
    const inputBox = await editor.boundingBox()
    expect(contextBox).not.toBeNull()
    expect(inputBox).not.toBeNull()
    expect(contextBox!.y).toBeLessThan(inputBox!.y)
    await trigger.click()
    if (process.env.DSH_GIT_BRANCH_SCREENSHOTS !== undefined) {
      await mkdir(process.env.DSH_GIT_BRANCH_SCREENSHOTS, { recursive: true })
      await page.screenshot({ path: join(process.env.DSH_GIT_BRANCH_SCREENSHOTS, 'desktop.png') })
    }
    await page.getByRole('searchbox', { name: 'Search branches' }).fill('session-header')
    await page.getByRole('menuitem', { name: longBranch, exact: true }).waitFor()
    await mkdir(expectedRoot, { recursive: true })
    await compareOrRefreshGolden(join(expectedRoot, 'menu.expected.md'), await captureStableAria(page, 'role=menu', scaffold.workspaceCwd), mode)
    await page.getByRole('menuitem', { name: longBranch, exact: true }).click()
    const changed = page.getByRole('button', { name: `Switch Git branch: ${longBranch}`, exact: true })
    await changed.waitFor()
    expect(await git('branch', '--show-current')).toBe(longBranch)
    await page.getByRole('alert').getByText(`Switched to ${longBranch}`, { exact: true }).waitFor()
    await page.getByRole('alert').waitFor({ state: 'hidden' })

    await page.setViewportSize({ width: 390, height: 844 })
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await changed.click()
      const menu = page.getByRole('menu')
      await menu.waitFor()
      const bounds = await menu.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(8)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(382)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
      if (process.env.DSH_GIT_BRANCH_SCREENSHOTS !== undefined) {
        await page.screenshot({ path: join(process.env.DSH_GIT_BRANCH_SCREENSHOTS, `mobile-${colorScheme}.png`) })
      }
      await page.keyboard.press('Escape')
      await menu.waitFor({ state: 'hidden' })
    }
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
