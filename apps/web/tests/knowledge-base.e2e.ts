/** Browser imports and the recorded Agent retrieve the same workspace-owned knowledge. */
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold,
  readPersistedEvents, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/knowledge-base/session.v4.jsonl', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./expected/knowledge-base/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const REVIEW = fileURLToPath(new URL('../../../.artifacts/knowledge-review/', import.meta.url))
const CONTENT = '# Publishing guide\nCheck subtitles and cover before publishing.\n'

describe.skipIf(MODE === 'record')('workspace knowledge management', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let consoleState: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      replayFixture: FIXTURE, compareReplaySession: true,
      extraOverlayPath: fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    consoleState = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl)
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  })

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('imports, reads, searches through native tools, and removes only after confirmation', async () => {
    await page.getByRole('button', { name: 'Plugins', exact: true }).click()
    await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor()
    expect(await page.getByRole('switch', { name: /Knowledge base/ }).count()).toBe(0)
    await page.getByRole('button', { name: 'Knowledge base', exact: true }).click()
    await page.getByRole('heading', { name: 'No documents yet', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Import document', exact: true }).click()
    await page.getByRole('dialog', { name: 'Import into project' }).waitFor()
    const fileChoice = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Choose file', exact: true }).click()
    await (await fileChoice).setFiles({ name: 'guide.md', mimeType: 'text/markdown', buffer: Buffer.from(CONTENT) })
    await page.getByRole('button', { name: 'Read source: guide.md', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Read source: guide.md', exact: true }).click()
    await page.getByText(CONTENT.trim(), { exact: true }).waitFor()
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    const previousPlatform = await page.evaluate(() => {
      const previous = document.documentElement.dataset['platform'] ?? null
      document.documentElement.dataset['platform'] = 'darwin'
      return previous
    })
    try {
      const heading = page.getByRole('heading', { name: 'Knowledge base', exact: true })
      expect(await heading.evaluate(element => getComputedStyle(element.closest('header')!).getPropertyValue('-webkit-app-region'))).toBe('drag')
      const workspace = page.getByRole('combobox', { name: 'Workspace', exact: true })
      expect(await workspace.evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region'))).toBe('no-drag')
      expect(await page.getByRole('button', { name: 'Import document', exact: true })
        .evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region'))).toBe('no-drag')
      expect(await page.getByRole('region', { name: 'Knowledge graph' })
        .evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region'))).not.toBe('drag')
      await workspace.click()
      await page.getByRole('option', { name: 'All projects', exact: true }).waitFor()
      await page.keyboard.press('Escape')
    } finally {
      await page.evaluate((previous) => {
        if (previous === null) delete document.documentElement.dataset['platform']
        else document.documentElement.dataset['platform'] = previous
      }, previousPlatform)
    }
    expect(await page.locator('select').count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Refresh', exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: /Zoom (in|out)/ }).count()).toBe(0)
    const graph = page.getByRole('region', { name: 'Knowledge graph' })
    const reset = graph.getByRole('button', { name: 'Reset view' })
    const resetOpacity = () => reset.evaluate(element => getComputedStyle(element.closest('[class*="graphControls"]')!).opacity)
    await page.getByRole('heading', { name: 'Knowledge base', exact: true }).hover()
    await expect.poll(resetOpacity).toBe('0')
    await graph.hover()
    await expect.poll(resetOpacity).toBe('1')
    const scene = graph.locator('[class*="graphScene"]')
    await page.mouse.wheel(0, -300)
    await expect.poll(() => scene.getAttribute('style')).not.toContain('scale(1)')
    const node = graph.getByRole('button', { name: 'Document: guide.md', exact: true })
    const before = await node.boundingBox()
    if (before === null) throw new Error('Document node is missing')
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
    await page.mouse.down()
    await page.mouse.move(before.x + before.width / 2 + 45, before.y + before.height / 2 + 25)
    await page.mouse.up()
    await expect.poll(async () => Math.abs((await node.boundingBox())!.x - before.x)).toBeGreaterThan(15)
    await reset.click()
    await expect.poll(() => scene.getAttribute('style')).toContain('scale(1)')
    await page.getByRole('status').filter({ hasText: 'Imported guide.md' }).waitFor({ state: 'hidden' })
    await mkdir(REVIEW, { recursive: true })
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme })
      await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme'))).toBe(theme === 'dark')
      await page.getByRole('heading', { name: 'Knowledge base', exact: true }).hover()
      await page.screenshot({ path: join(REVIEW, `desktop-${theme}.png`) })
    }
    await page.getByRole('combobox', { name: 'Workspace', exact: true }).click()
    await page.getByRole('option', { name: 'All projects', exact: true }).waitFor()
    await page.screenshot({ path: join(REVIEW, 'project-selector.png') })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Home', exact: true }).click()
    const [prompt] = fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))
    if (prompt === undefined) throw new Error('Knowledge fixture has no user prompt')
    await page.locator('[data-composer-input]').first().fill(prompt)
    const settled = scaffold.whenTurnSettled()
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    const sessionId = await settled
    const events = await readPersistedEvents(scaffold, sessionId)
    const result = events.find(event => event.type === 'tool/result')
    expect(JSON.stringify(result)).toContain('Check subtitles and cover before publishing.')
    expect(JSON.stringify(result)).toContain('knowledge-upload://guide.md')
    await connectFreshWorkspace(page, scaffold.workspaceCwd, 'research')
    await page.getByRole('button', { name: 'Knowledge base', exact: true }).click()
    await page.getByRole('button', { name: 'Import document', exact: true }).click()
    const importDialog = page.getByRole('dialog', { name: 'Import into project' })
    await importDialog.getByRole('combobox', { name: 'Workspace' }).click()
    await page.getByRole('option', { name: 'research', exact: true }).click()
    const researchChoice = page.waitForEvent('filechooser')
    await importDialog.getByRole('button', { name: 'Choose file', exact: true }).click()
    await (await researchChoice).setFiles({ name: 'research.md', mimeType: 'text/markdown',
      buffer: Buffer.from('# Research\n' + 'Check publishing sources and document research findings.\n'.repeat(120)) })
    await page.getByRole('button', { name: 'Read source: research.md', exact: true }).waitFor()
    expect(await page.getByRole('button', { name: /^Read source:/ }).count()).toBe(2)
    await page.getByRole('button', { name: 'Read source: research.md', exact: true }).click()
    const passages = page.getByRole('combobox', { name: 'Source passages', exact: true })
    await passages.click()
    await page.getByRole('option', { name: /^Passage 2 of / }).click()
    await page.getByRole('button', { name: 'Previous passage', exact: true }).waitFor({ state: 'visible' })
    expect(await page.getByRole('button', { name: 'Previous passage', exact: true }).isEnabled()).toBe(true)
    const projects = page.getByRole('combobox', { name: 'Workspace', exact: true })
    const globalLayout = await knowledgeLayout(page)
    await projects.click()
    await page.getByRole('option', { name: 'workspace', exact: true }).click()
    await expect.poll(() => page.getByRole('button', { name: /^Read source:/ }).count()).toBe(1)
    expect(await page.getByRole('button', { name: 'Read source: guide.md', exact: true }).count()).toBe(1)
    await page.getByText(CONTENT.trim(), { exact: true }).waitFor()
    await expect.poll(() => knowledgeLayout(page)).toEqual(globalLayout)
    await projects.click()
    await page.getByRole('option', { name: 'All projects', exact: true }).click()
    await page.getByRole('button', { name: 'Read source: research.md', exact: true }).waitFor()
    await expect.poll(() => knowledgeLayout(page)).toEqual(globalLayout)
    await page.getByRole('button', { name: 'Read source: guide.md', exact: true }).click()
    await page.getByText(CONTENT.trim(), { exact: true }).waitFor()
    await expect.poll(() => knowledgeLayout(page)).toEqual(globalLayout)
    await page.getByRole('button', { name: 'Read source: research.md', exact: true }).click()
    await passages.waitFor()
    await expect.poll(() => knowledgeLayout(page)).toEqual(globalLayout)
    const reader = page.getByRole('region', { name: 'Source passages', exact: true })
    await expect.poll(() => reader.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await reader.evaluate((element) => { element.scrollTop = 80 })
    await expect.poll(() => reader.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect.poll(() => knowledgeLayout(page)).toEqual(globalLayout)
    await page.getByRole('status').filter({ hasText: 'Imported research.md' }).waitFor({ state: 'hidden' })
    await page.screenshot({ path: join(REVIEW, 'global-projects.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await projects.click()
    const popup = await page.getByRole('listbox').boundingBox()
    if (popup === null) throw new Error('Project selector did not open')
    expect(popup.x).toBeGreaterThanOrEqual(0)
    expect(popup.x + popup.width).toBeLessThanOrEqual(390)
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const narrowLayout = await knowledgeLayout(page)
    await page.getByRole('button', { name: 'Read source: guide.md', exact: true }).click()
    await page.getByText(CONTENT.trim(), { exact: true }).waitFor()
    await expect.poll(() => knowledgeLayout(page)).toEqual(narrowLayout)
    await projects.click()
    await page.getByRole('option', { name: 'workspace', exact: true }).click()
    await expect.poll(() => page.getByRole('button', { name: /^Read source:/ }).count()).toBe(1)
    await expect.poll(() => knowledgeLayout(page)).toEqual(narrowLayout)
    await projects.click()
    await page.getByRole('option', { name: 'All projects', exact: true }).click()
    await page.getByRole('button', { name: 'Read source: research.md', exact: true }).waitFor()
    await page.screenshot({ path: join(REVIEW, 'mobile-390.png') })
    await page.setViewportSize({ width: 1680, height: 1000 })
    await page.getByRole('button', { name: 'Remove research.md', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click()
    await page.getByRole('button', { name: 'Read source: research.md', exact: true }).waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Remove guide.md', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await page.getByRole('button', { name: 'Read source: guide.md', exact: true }).count()).toBe(1)
    const content = page.locator('section[class*="page"] > [class*="content"]')
    const contentBounds = await content.boundingBox()
    const searchBounds = await page.getByRole('textbox', { name: 'Search', exact: true }).boundingBox()
    await page.getByRole('button', { name: 'Remove guide.md', exact: true }).click()
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
    await page.getByRole('heading', { name: 'No documents yet', exact: true }).waitFor()
    expect(await page.getByRole('textbox', { name: 'Search', exact: true }).boundingBox()).toEqual(searchBounds)
    expect(await page.locator('section[class*="page"] > [class*="content"]').boundingBox()).toEqual(contentBounds)
    expect(consoleState.pageErrors).toEqual([])
  })
})

async function knowledgeLayout(page: Page) {
  return await page.locator('section[class*="page"]').evaluate((root) => {
    const layout: Record<string, { top: number; height: number }> = {}
    const offset = root.getBoundingClientRect().top - root.scrollTop
    for (const name of ['graphPanel', 'documentsPanel', 'reader', 'searchBar']) {
      const element = root.querySelector(`[class*="${name}"]`)
      if (element === null) throw new Error(`Knowledge region is missing: ${name}`)
      const rect = element.getBoundingClientRect()
      // A narrow page scrolls to bring the clicked document into view.
      layout[name] = { top: Math.round(rect.top - offset), height: Math.round(rect.height) }
    }
    return layout
  })
}
