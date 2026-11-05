/** Browser imports and the recorded Agent retrieve the same workspace-owned knowledge. */
import { readFile } from 'node:fs/promises'
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
    await page.locator('input[type="file"]').setInputFiles({ name: 'guide.md', mimeType: 'text/markdown', buffer: Buffer.from(CONTENT) })
    await page.getByRole('button', { name: 'Read source: guide.md', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Read source: guide.md', exact: true }).click()
    await page.getByText(CONTENT.trim(), { exact: true }).waitFor()
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    await page.getByRole('button', { name: 'All documents', exact: true }).click()
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
    await page.getByRole('button', { name: 'Knowledge base', exact: true }).click()
    await page.getByRole('button', { name: 'Remove guide.md', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await page.getByRole('button', { name: 'Read source: guide.md', exact: true }).count()).toBe(1)
    await page.getByRole('button', { name: 'Remove guide.md', exact: true }).click()
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
    await page.getByRole('heading', { name: 'No documents yet', exact: true }).waitFor()
    expect(consoleState.pageErrors).toEqual([])
  })
})
