/** Shipped-Web replay of planned dependencies, live revisions, and historical task details. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, onTestFinished } from 'vitest'
import type {} from '@deepseek-ai/dsh-tool-todo'
import {
  captureStableAria, compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold,
  watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, expandOwningTurnProcess, newEnglishPage, REPO_ROOT, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const SNAPSHOTS = fileURLToPath(new URL('../../../snapshots/web/workflow-canvas', import.meta.url))
const FIXTURE = join(REPO_ROOT, 'snapshots/session/workflow-canvas/session.v4.jsonl')

describe.skipIf(MODE === 'record')('web e2e: task workflow canvas', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let consoleWatch: ReturnType<typeof watchConsole>
  let prompt: string
  const continuePlan = Promise.withResolvers<undefined>()

  beforeAll(async () => {
    prompt = fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))[0]!
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, compareReplaySession: false })
    // The barrier holds the next model request after the real tool has committed its first plan.
    scaffold.ctx.on('llm/stream', async function* (options, next) {
      const session = options.sessionId === undefined ? undefined : scaffold.ctx.sessions.get(options.sessionId)
      if (session !== undefined) {
        const { values } = scaffold.ctx.sessionProjections.snapshot(session)
        if (values.todos?.some(task => task.status === 'in_progress')) await continuePlan.promise
      }
      yield* next()
    }, { prepend: true })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    consoleWatch = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const [session] = scaffold.ctx.sessions.list()
    expect(session).toBeDefined()
    scaffold.ctx.permissionPresets.set(session!, 'danger-full-access')
  })

  afterAll(async () => {
    continuePlan.resolve(undefined)
    try { await browser?.close() } finally { await scaffold?.close() }
  })

  it('shows planned parallel work, opens task details, and restores the updated graph after reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-workflow-canvas'))
    onTestFinished(() => { continuePlan.resolve(undefined) })
    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input]').first()
    await input.fill(prompt)
    await input.press('Enter')
    const preview = page.locator('[data-workflow-canvas]').first()
    await expandOwningTurnProcess(page, preview)
    await preview.waitFor({ timeout: 30_000 })
    await expect.poll(() => preview.locator('.react-flow__node').count()).toBe(3)
    await expect.poll(() => preview.locator('.react-flow__edge').count()).toBe(2)

    await page.getByRole('tab', { name: 'Workflow', exact: true }).click()
    const workflow = page.getByRole('region', { name: 'Workflow', exact: true })
    const phase = workflow.getByRole('button', { name: 'Prepare · 2', exact: true })
    await phase.click()
    await expect.poll(() => workflow.locator('.react-flow__node').count()).toBe(2)
    await expect.poll(() => workflow.locator('.react-flow__edge').count()).toBe(1)
    await phase.click()
    await expect.poll(() => workflow.locator('.react-flow__node').count()).toBe(3)
    await page.screenshot({ path: join(REPO_ROOT, '.artifacts/workflow-canvas-preview.png'), fullPage: true })
    await workflow.getByRole('button', { name: 'Inspect write the fix, Waiting for prerequisites', exact: true }).click()
    const details = page.getByRole('article', { name: 'Task details', exact: true })
    await details.getByText('An implementation with a focused regression test.', { exact: true }).waitFor()
    expect(await details.getByRole('heading', { name: 'Prerequisites' }).count()).toBe(1)
    await compareOrRefreshGolden(join(SNAPSHOTS, 'task.expected.md'), await captureStableAria(page, 'article[aria-label="Task details"]', scaffold.workspaceCwd), MODE)
    await page.getByRole('button', { name: 'Collapse right sidebar', exact: true }).click()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
    await workflow.getByRole('tab', { name: 'List', exact: true }).click()
    await workflow.getByRole('button', { name: 'Inspect read the code, Running', exact: true }).waitFor()
    expect(await workflow.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await compareOrRefreshGolden(join(SNAPSHOTS, 'live.expected.md'), await captureStableAria(page, 'section[aria-label="Workflow"]', scaffold.workspaceCwd), MODE)

    continuePlan.resolve(undefined)
    await settled
    await workflow.getByRole('button', { name: 'Inspect read the code, Completed', exact: true }).waitFor()
    await page.reload({ waitUntil: 'load' })
    const restored = page.getByRole('region', { name: 'Workflow', exact: true })
    await restored.waitFor()
    await restored.getByRole('tab', { name: 'List', exact: true }).click()
    await restored.getByRole('button', { name: 'Inspect write the fix, Completed', exact: true }).waitFor()
    await compareOrRefreshGolden(join(SNAPSHOTS, 'settled.expected.md'), await captureStableAria(page, 'section[aria-label="Workflow"]', scaffold.workspaceCwd), MODE)
    expect(consoleWatch.pageErrors).toEqual([])
    expect(consoleWatch.warnings).toEqual([])
  })
})

describe.skipIf(MODE === 'record')('web e2e: branching workflow and follow-up messages', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  const directory = join(REPO_ROOT, 'snapshots/web/workflow-branches')
  let consoleWatch: ReturnType<typeof watchConsole>
  const continueBranches = Promise.withResolvers<undefined>()
  let prompts: readonly string[]

  beforeAll(async () => {
    const fixture = join(directory, 'session.v4.jsonl')
    prompts = fixtureUserPrompts(await readFile(fixture, 'utf8'))
    scaffold = await launchWebScaffold({ replayFixture: fixture, compareReplaySession: false })
    scaffold.ctx.on('llm/stream', async function* (options, next) {
      const session = options.sessionId === undefined ? undefined : scaffold.ctx.sessions.get(options.sessionId)
      if (session !== undefined && scaffold.ctx.sessionProjections.snapshot(session).values.todos?.some(task => task.status === 'in_progress')) {
        await continueBranches.promise
      }
      yield* next()
    }, { prepend: true })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    consoleWatch = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const [session] = scaffold.ctx.sessions.list()
    expect(session).toBeDefined()
    scaffold.ctx.permissionPresets.set(session!, 'danger-full-access')
  })

  afterAll(async () => {
    continueBranches.resolve(undefined)
    try { await browser?.close() } finally { await scaffold?.close() }
  })

  it('renders multiple starts, forks, joins and outputs, then follows a new turn without a todo write', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-workflow-branches'))
    onTestFinished(() => { continueBranches.resolve(undefined) })
    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill(prompts[0]!)
    await input.press('Enter')
    await page.getByRole('tab', { name: 'Workflow', exact: true }).click()
    const workflow = page.getByRole('region', { name: 'Workflow', exact: true })
    await expect.poll(() => workflow.locator('.react-flow__node').count()).toBe(16)
    await expect.poll(() => workflow.locator('.react-flow__edge').count()).toBe(18)
    const tabs = await page.getByRole('tablist').first().getByRole('tab').allTextContents()
    expect(tabs).toEqual(['Chat', 'Trajectory', 'Workflow'])
    await workflow.getByRole('button', { name: 'Inspect Explore branch 3, Waiting to run', exact: true }).waitFor()
    await expect.poll(() => workflow.locator('.react-flow').evaluate((canvas) => {
      const bounds = canvas.getBoundingClientRect()
      return [...canvas.querySelectorAll('.react-flow__node')].every((node) => {
        const box = node.getBoundingClientRect()
        return box.left >= bounds.left && box.top >= bounds.top && box.right <= bounds.right && box.bottom <= bounds.bottom
      })
    })).toBe(true)
    await page.screenshot({ path: join(REPO_ROOT, '.artifacts/workflow-branches-preview.png'), fullPage: true })
    const research = workflow.getByRole('button', { name: 'Research · 6', exact: true })
    await research.click()
    await expect.poll(() => workflow.locator('.react-flow__node').count()).toBe(11)
    await research.click()
    const outputs = workflow.getByRole('button', { name: 'Outputs · 4', exact: true })
    await outputs.click()
    await expect.poll(() => workflow.locator('.react-flow__node').count()).toBe(14)
    await outputs.click()
    await workflow.getByRole('button', { name: 'Inspect Summarize user interface, Waiting for prerequisites', exact: true }).click()
    const inspector = page.getByRole('article', { name: 'Task details', exact: true })
    expect(await inspector.getByRole('listitem').count()).toBe(3)
    await page.getByRole('button', { name: 'Collapse right sidebar', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
    await workflow.getByRole('tab', { name: 'List', exact: true }).click()
    expect(await workflow.getByRole('listitem').count()).toBe(16)
    expect(await workflow.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await compareOrRefreshGolden(join(directory, 'branches.expected.md'),
      await captureStableAria(page, 'section[aria-label="Workflow"]', scaffold.workspaceCwd), MODE)
    continueBranches.resolve(undefined)
    await settled
    await workflow.getByRole('button', { name: 'Inspect Deliver report, Completed', exact: true }).waitFor()
    const following = scaffold.whenTurnSettled()
    await input.fill(prompts[1]!)
    await input.press('Enter')
    await following
    await workflow.getByRole('button', { name: 'Inspect Handle this message, Completed', exact: true }).waitFor()
    expect(await workflow.getByRole('listitem').count()).toBe(1)
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('region', { name: 'Workflow', exact: true })
      .getByRole('button', { name: 'Inspect Handle this message, Completed', exact: true }).waitFor()
    await compareOrRefreshGolden(join(directory, 'followup.expected.md'),
      await captureStableAria(page, 'section[aria-label="Workflow"]', scaffold.workspaceCwd), MODE)
    expect(consoleWatch.pageErrors).toEqual([])
    expect(consoleWatch.warnings).toEqual([])
  })
})
