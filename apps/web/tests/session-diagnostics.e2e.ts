/** Real Settings navigation, historical indexing and preview-confirmed local diagnostic reports. */
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ToolCallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { strFromU8, unzipSync } from 'fflate'
import { chromium, type Locator, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole } from './scaffold.ts'
import { expandTurnProcesses, newEnglishPage, openSettings, pinBrowserClock, scrollIntoView, selectField, WEB_FIXTURE_TIME } from './support.ts'

const SEED_ID = 'session-diagnostics-web-e2e'
const FIXTURE_TITLE = 'Diagnostics failure fixture'
const ARGUMENT_SECRET = 'fixture-only-api-key-not-for-export'
const RAW_ARGUMENT = 'fixture-only-raw-argument-not-for-export'
const SUCCESS_OUTPUT = 'fixture-only-success-output-not-for-export'
const SUMMARY = 'The validation errors and failed command are ready for review.'
const ARTIFACT_ROOT = fileURLToPath(new URL('../../../.artifacts/session-diagnostics/', import.meta.url))
const UI_WAIT = { timeout: 10_000 }

const COPY = {
  nav: 'Diagnostics', title: 'Diagnostics and errors', scope: 'Scope', all: 'All projects', category: 'Category', time: 'Time',
  shortcut: 'View error record', focusedSession: 'Source Session',
  search: 'Search failures', refresh: 'Refresh index', empty: 'No matching errors in the available index.',
  export: 'Export report', selected: 'Export selected (1)', exportGroup: 'Export this group',
  details: 'Error details', source: 'Open source Session', preview: 'Review diagnostic report',
  download: 'Download local ZIP', cancel: 'Cancel', unknown: 'Cause and recovery have not been verified.',
  privacy: 'Common credentials and home directory names are masked, but arbitrary error text may still contain private information. Review the complete preview before sharing. No full conversations, attachments, raw arguments or successful command output are included.',
} as const

/** Current-format durable failures stay cold until the Settings action explicitly indexes them. */
function diagnosticSeed(): { text: string; argumentSeqs: number[]; commandSeq: number } {
  const session = Session.create(SessionId('diagnostic-seed-source'))
  const events: SessionEvent[] = []
  events.push(session.append('turn/start', { turn: 1 }))
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Inspect the repeated validation errors and command failure.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  events.push(user)
  events.push(session.append('session/title', { title: FIXTURE_TITLE, messageSeqs: [user.seq], source: { kind: 'fallback' } }))
  const argumentSeqs: number[] = []
  let commandSeq: number | undefined
  for (const step of [1, 2, 3, 4]) {
    const argumentFailure = step <= 2
    const commandFailure = step === 3
    const name = argumentFailure ? 'todo_write' : 'bash'
    const callId = ToolCallId(`diagnostics-call-${step}`)
    const arguments_ = JSON.stringify(argumentFailure
      ? { todos: [], token: RAW_ARGUMENT }
      : { command: commandFailure ? 'exit 7' : 'printf success', description: 'Inspect diagnostic command' })
    events.push(session.append('step/start', { turn: 1, step }))
    events.push(session.append('assistant/message', {
      turn: 1, step, stream: [],
      message: createAssistantMessage({
        content: [{ type: 'tool-call', id: callId, name, arguments: arguments_ }],
        source: { provider: 'snapshot', model: 'diagnostic-fixture' },
      }),
    }, { surfaceOp: 'append' }))
    const call = session.append('tool/call', { turn: 1, step, callId, name, arguments: arguments_ })
    events.push(call)
    const result = session.append('tool/result', {
      turn: 1, step,
      message: createToolResultMessage({
        callId, isError: argumentFailure,
        content: [{ type: 'text', text: argumentFailure
          ? `Required field is missing\napi_key=${ARGUMENT_SECRET}`
          : commandFailure ? 'Command failed\n[exit code: 7]' : SUCCESS_OUTPUT }],
      }),
      ...(argumentFailure ? { error: { name: 'Error', code: 'INVALID_ARGS' } } : {
        meta: { shellOutcome: {
          kind: 'foreground', exitCode: commandFailure ? 7 : 0, signal: null,
          timedOut: false, aborted: false, timeoutMs: 1000,
        } },
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    events.push(result)
    if (argumentFailure) argumentSeqs.push(result.seq)
    if (commandFailure) commandSeq = result.seq
    events.push(session.append('step/end', { turn: 1, step }))
  }
  events.push(session.append('step/start', { turn: 1, step: 5 }))
  events.push(session.append('assistant/message', {
    turn: 1, step: 5, stream: [],
    message: createAssistantMessage({
      content: [{ type: 'text', text: SUMMARY }], source: { provider: 'snapshot', model: 'diagnostic-fixture' },
    }),
  }, { surfaceOp: 'append' }))
  events.push(session.append('step/end', { turn: 1, step: 5 }))
  events.push(session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }))
  if (commandSeq === undefined) throw new Error('Missing failing command in diagnostics fixture')
  return { argumentSeqs, commandSeq, text: [
    JSON.stringify({
      type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}', createdAt: 0,
      cwd: '{{cwd}}', isSeeded: false, delegationDepth: 0,
    }),
    ...events.map(event => JSON.stringify(event)), '',
  ].join('\n') }
}

/** A reachable action must retain its full horizontal target at the active viewport width. */
async function expectReachable(page: Page, control: Locator): Promise<void> {
  await scrollIntoView(control)
  await control.waitFor({ state: 'visible' })
  const box = await control.boundingBox()
  if (box === null) throw new Error('Diagnostic action has no rendered target')
  const viewport = page.viewportSize()
  if (viewport === null) throw new Error('Diagnostic scenario requires a fixed viewport')
  expect(box.x).toBeGreaterThanOrEqual(-1)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(box.width).toBeGreaterThan(0)
  expect(box.height).toBeGreaterThan(0)
}

async function expectNoHorizontalOverflow(page: Page, content: Locator): Promise<void> {
  await expect.poll(() => page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  ), UI_WAIT).toBe(true)
  expect(await content.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
}

async function capture(page: Page, directory: string, name: string): Promise<void> {
  await page.evaluate(async () => { await document.fonts.ready })
  await page.mouse.move(1, 1)
  await page.screenshot({ path: join(directory, name), fullPage: true, animations: 'disabled' })
}

it('indexes cold failures through Settings, groups repeated errors and downloads only the confirmed local report', async () => {
  await mkdir(ARTIFACT_ROOT, { recursive: true })
  const artifacts = await mkdtemp(join(ARTIFACT_ROOT, 'real-web-'))
  const scaffold = await launchWebScaffold()
  try {
    const seed = diagnosticSeed()
    await seedSession(scaffold, seed.text, SEED_ID, undefined, { createdAt: WEB_FIXTURE_TIME })
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await pinBrowserClock(page)
      await page.emulateMedia({ colorScheme: 'light' })
      const tripwire = watchConsole(page)
      const downloads: string[] = []
      page.on('download', (download) => { downloads.push(download.suggestedFilename()) })
      await page.goto(scaffold.authenticatedUrl)
      await openSettings(page, 'en')
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
      const diagnosticsTab = settings.getByRole('button', { name: COPY.nav, exact: true })
      await expect.poll(async () => ({
        visible: await diagnosticsTab.isVisible(), warnings: tripwire.warnings, pageErrors: tripwire.pageErrors,
      }), UI_WAIT).toEqual({ visible: true, warnings: [], pageErrors: [] })
      const diagnosticResponses: string[] = []
      page.on('response', (response) => {
        const pathname = new URL(response.url()).pathname
        if (pathname.startsWith('/api/')) diagnosticResponses.push(`${response.status()} ${pathname}`)
      })
      await diagnosticsTab.click()
      const heading = page.getByRole('heading', { name: COPY.title, exact: true })
      await heading.waitFor()
      const diagnostics = settings.locator('section').filter({ has: heading }).first()
      const refresh = diagnostics.getByRole('button', { name: COPY.refresh, exact: true })
      const exportReport = diagnostics.getByRole('button', { name: COPY.export, exact: true })
      try {
        await diagnostics.getByText(/Unindexed Sessions: 1/).waitFor(UI_WAIT)
      } catch (error: unknown) {
        const evidence = { rendered: await diagnostics.innerText(), api: diagnosticResponses, ...tripwire }
        throw new Error(JSON.stringify(evidence), { cause: error })
      }
      await diagnostics.getByText(COPY.empty, { exact: true }).waitFor()
      expect(await diagnostics.getByRole('combobox', { name: COPY.scope }).textContent()).toContain(COPY.all)
      expect(await exportReport.isDisabled()).toBe(true)
      expect(await diagnostics.getByRole('button', { name: /INVALID_ARGS|EXIT_7/ }).count()).toBe(0)
      await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme')), UI_WAIT).toBe(false)
      await capture(page, artifacts, 'desktop-light-unindexed.png')

      await refresh.click()
      const argumentsGroup = diagnostics.getByRole('button', { name: /Arguments · todo_write · INVALID_ARGS/ })
      const commandGroup = diagnostics.getByRole('button', { name: /Command · bash · EXIT_7/ })
      await argumentsGroup.waitFor()
      await commandGroup.waitFor()
      await expect.poll(() => diagnostics.getByRole('checkbox').count(), UI_WAIT).toBe(2)
      await expect.poll(() => diagnostics.getByText(/Unindexed Sessions:/).count(), UI_WAIT).toBe(0)
      expect(await argumentsGroup.textContent()).toContain('Occurrences: 2')
      expect(await commandGroup.textContent()).toContain('Occurrences: 1')
      expect(await exportReport.isEnabled()).toBe(true)
      expect(await diagnostics.textContent()).not.toContain(ARGUMENT_SECRET)
      expect(await diagnostics.textContent()).not.toContain(SUCCESS_OUTPUT)
      await capture(page, artifacts, 'desktop-light-groups.png')

      await page.emulateMedia({ colorScheme: 'dark' })
      await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme')), UI_WAIT).toBe(true)
      await capture(page, artifacts, 'desktop-dark-groups.png')
      await argumentsGroup.click()
      const detail = diagnostics.getByRole('region', { name: COPY.details, exact: true })
      await detail.waitFor()
      await detail.getByText(COPY.unknown, { exact: true }).waitFor()
      for (const seq of seed.argumentSeqs) await detail.getByText(`Event #${seq} · Turn 1`, { exact: true }).waitFor()
      expect(await detail.getByRole('button', { name: COPY.source, exact: true }).count()).toBe(2)
      expect(await detail.locator('pre').allTextContents()).toEqual([
        'Required field is missing\napi_key=[redacted]', 'Required field is missing\napi_key=[redacted]',
      ])
      await scrollIntoView(detail.getByRole('heading', { name: COPY.details, exact: true }))
      await capture(page, artifacts, 'desktop-dark-details.png')
      await detail.getByRole('button', { name: COPY.exportGroup, exact: true }).click()
      const preview = page.getByRole('dialog', { name: COPY.preview, exact: true })
      await preview.waitFor()
      expect(await preview.locator('pre').textContent()).toContain('INVALID_ARGS')
      expect(await preview.locator('pre').textContent()).not.toContain('EXIT_7')
      await preview.getByRole('button', { name: COPY.cancel, exact: true }).click()
      await preview.waitFor({ state: 'detached' })
      expect(downloads).toEqual([])

      const selected = diagnostics.getByRole('checkbox', { name: 'Select group for export: Required field is missing', exact: true })
      await selected.check()
      await diagnostics.getByRole('button', { name: COPY.selected, exact: true }).click()
      await preview.waitFor()
      await preview.getByText(COPY.privacy, { exact: true }).waitFor()
      const previewText = await preview.locator('pre').textContent()
      if (previewText === null) throw new Error('Diagnostic report preview is empty')
      expect(JSON.parse(previewText)).toMatchObject({
        formatVersion: 1, incomplete: false,
        groups: [{ code: 'INVALID_ARGS', count: 2, occurrences: [
          { sessionId: SEED_ID, eventSeq: seed.argumentSeqs[1] }, { sessionId: SEED_ID, eventSeq: seed.argumentSeqs[0] },
        ] }],
      })
      expect(previewText).not.toContain('EXIT_7')
      expect(previewText).not.toContain(ARGUMENT_SECRET)
      expect(previewText).not.toContain(RAW_ARGUMENT)
      expect(previewText).not.toContain(SUCCESS_OUTPUT)
      expect(previewText).not.toContain(scaffold.workspaceCwd)
      expect(downloads).toEqual([])
      await capture(page, artifacts, 'desktop-dark-report-preview.png')
      await page.setViewportSize({ width: 390, height: 844 })
      await expectNoHorizontalOverflow(page, preview)
      await expectReachable(page, preview.getByRole('button', { name: COPY.download, exact: true }))
      await capture(page, artifacts, 'narrow-dark-report-preview.png')
      const [download] = await Promise.all([
        page.waitForEvent('download'), preview.getByRole('button', { name: COPY.download, exact: true }).click(),
      ])
      expect(download.suggestedFilename()).toMatch(/^diagnostics-.+\.zip$/)
      const files = unzipSync(await readFile(await download.path()))
      expect(Object.keys(files).sort()).toEqual(['diagnostics.json', 'diagnostics.md'])
      expect(strFromU8(files['diagnostics.json']!)).toBe(previewText)
      const markdown = strFromU8(files['diagnostics.md']!)
      expect(markdown).toContain('# Local diagnostic report')
      expect(markdown).toContain('Occurrences: 2')
      expect(markdown).toContain(SEED_ID)
      expect(markdown).not.toContain('EXIT_7')
      expect(markdown).not.toContain(ARGUMENT_SECRET)
      expect(markdown).not.toContain(RAW_ARGUMENT)
      expect(markdown).not.toContain(SUCCESS_OUTPUT)
      await preview.waitFor({ state: 'detached' })
      expect(downloads).toHaveLength(1)

      await expectNoHorizontalOverflow(page, diagnostics)
      const nav = settings.getByRole('navigation')
      await expect.poll(async () => (await nav.boundingBox())?.width, UI_WAIT).toBe(390)
      await expectReachable(page, refresh)
      await expectReachable(page, diagnostics.getByRole('button', { name: COPY.selected, exact: true }))
      await scrollIntoView(heading)
      await capture(page, artifacts, 'narrow-dark-groups.png')
      await expectReachable(page, detail.getByRole('button', { name: COPY.exportGroup, exact: true }))
      await scrollIntoView(detail.getByRole('heading', { name: COPY.details, exact: true }))
      await capture(page, artifacts, 'narrow-dark-details.png')

      await page.setViewportSize({ width: 1680, height: 1000 })
      await page.emulateMedia({ colorScheme: 'light' })
      await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme')), UI_WAIT).toBe(false)
      await selectField(diagnostics.getByRole('combobox', { name: COPY.category }), 'command')
      await commandGroup.waitFor()
      await expect.poll(() => argumentsGroup.count(), UI_WAIT).toBe(0)
      await expect.poll(() => diagnostics.getByRole('checkbox').count(), UI_WAIT).toBe(1)
      await selectField(diagnostics.getByRole('combobox', { name: COPY.time }), '1')
      await commandGroup.waitFor()
      await diagnostics.getByRole('textbox', { name: COPY.search, exact: true }).fill('EXIT_7')
      await commandGroup.waitFor()
      await exportReport.click()
      await preview.waitFor()
      const filteredText = await preview.locator('pre').textContent()
      expect(filteredText).toContain('EXIT_7')
      expect(filteredText).not.toContain('INVALID_ARGS')
      await preview.getByRole('button', { name: COPY.cancel, exact: true }).click()
      await preview.waitFor({ state: 'detached' })
      await diagnostics.getByRole('textbox', { name: COPY.search, exact: true }).fill('')
      await selectField(diagnostics.getByRole('combobox', { name: COPY.category }), '')
      await argumentsGroup.waitFor()
      await argumentsGroup.click()
      await detail.waitFor()
      await detail.getByRole('button', { name: COPY.source, exact: true }).first().click()
      await settings.waitFor({ state: 'detached' })
      await page.getByText(SUMMARY, { exact: true }).waitFor()
      await expandTurnProcesses(page)
      const shortcuts = page.getByRole('button', { name: COPY.shortcut, exact: true })
      const commandShortcut = page.locator('[data-chat-call-id="diagnostics-call-3"]').getByRole('button', { name: COPY.shortcut, exact: true })
      await commandShortcut.waitFor()
      expect(await shortcuts.count()).toBe(3)
      await commandShortcut.click()
      await settings.waitFor()
      expect(await settings.count()).toBe(1)
      await expect.poll(() => diagnostics.getByRole('combobox', { name: COPY.scope }).textContent(), UI_WAIT).toContain(COPY.focusedSession)
      await detail.getByText(`Event #${seed.commandSeq} · Turn 1`, { exact: true }).waitFor()
      expect(await commandGroup.getAttribute('aria-expanded')).toBe('true')
      await scrollIntoView(detail.getByRole('heading', { name: COPY.details, exact: true }))
      await capture(page, artifacts, 'desktop-light-card-shortcut.png')
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
})
