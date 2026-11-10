/** Team transcript over the shipped profile, recorded model streams, and real member/tool execution. */
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, onTestFinished } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-session-title'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  captureStableAria, compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold,
  seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, pinBrowserClock, pinHostClock, REPO_ROOT, saveFailureShot, WEB_FIXTURE_TIME } from './support.ts'

const MODE = webSnapshotMode()
const SNAPSHOTS = fileURLToPath(new URL('../../../snapshots/web/team-view', import.meta.url))
const FIXTURE = join(REPO_ROOT, 'snapshots/session/team-direct-inbox/session.v4.jsonl')
const CHILD_FIXTURE = join(REPO_ROOT, 'snapshots/session/team-direct-inbox/session.1.v4.jsonl')
const TEAM_OVERLAY = fileURLToPath(new URL('./agent-team-panel.overlay.yml', import.meta.url))

describe.skipIf(MODE === 'record')('web e2e: Team view', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let consoleWatch: ReturnType<typeof watchConsole>
  let leadId: SessionId
  let prompt: string
  let hostClock: ReturnType<typeof pinHostClock> | undefined
  const releaseFirstRequest = Promise.withResolvers<undefined>()
  const firstRequest = Promise.withResolvers<undefined>()
  const releaseReply = Promise.withResolvers<undefined>()
  const replyPrefix = Promise.withResolvers<undefined>()

  beforeAll(async () => {
    hostClock = pinHostClock()
    prompt = fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))[0]!
    scaffold = await launchWebScaffold({
      replayFixture: FIXTURE, replayChildFixtures: [CHILD_FIXTURE], compareReplaySession: false,
      extraOverlayPath: [TEAM_OVERLAY, join(REPO_ROOT, 'apps/web/tests/pin-browse-picker.overlay.yml')],
      extraInstallAnchors: [join(REPO_ROOT, 'packages/experimental/agent-team-profile/package.json')],
    })
    leadId = SessionId('team-view-conversation')
    const history = Session.create(leadId)
    history.append('turn/start', { turn: 1 })
    history.append('step/start', { turn: 1, step: 1 })
    const opening = history.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Show the team conversation.' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    history.append('session/title', { title: 'Team view conversation', messageSeqs: [opening.seq], source: { kind: 'fallback' } })
    history.append('request/header', {
      header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }, reason: 'initial',
    })
    history.append('assistant/message', {
      turn: 1, step: 1, stream: [], message: createMessage({ role: 'assistant',
        content: [{ type: 'text', text: 'Ready for team collaboration.' }],
        source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      }),
    }, { surfaceOp: 'append' })
    history.append('step/end', { turn: 1, step: 1 })
    history.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const header = { type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}',
      createdAt: WEB_FIXTURE_TIME - 60_000, cwd: '{{cwd}}', isSeeded: false, delegationDepth: 0 }
    await seedSession(scaffold, [JSON.stringify(header), ...history.snapshotEvents().map(event => JSON.stringify(event)), ''].join('\n'), leadId,
      undefined, { createdAt: WEB_FIXTURE_TIME - 60_000 })
    scaffold.ctx.on('agent/created', ({ agent }) => {
      if (agent.id === leadId) scaffold.ctx.permissionPresets.set(agent.session, 'danger-full-access')
    })
    let requests = 0
    // Barriers expose pre-token thinking and an unfinished text delta without depending on machine speed.
    scaffold.ctx.on('llm/stream', async function* (options, next) {
      if (options.sessionId === leadId && ++requests === 1) {
        firstRequest.resolve(undefined)
        await releaseFirstRequest.promise
      }
      for await (const chunk of next()) {
        if (options.sessionId === leadId && chunk.type === 'text-delta' && chunk.text === 'TEAM_DIRECT_INBOX_OK') {
          yield { ...chunk, text: 'TEAM_DIRECT_' }
          replyPrefix.resolve(undefined)
          await releaseReply.promise
          yield { ...chunk, text: 'INBOX_OK' }
        } else yield chunk
      }
    }, { prepend: true })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await pinBrowserClock(page)
    consoleWatch = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.getByRole('button', { name: 'Search sessions', exact: true }).click()
    await page.getByRole('textbox', { name: 'Search session names', exact: true }).fill('Show the team conversation.')
    const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
    await results.first().waitFor({ timeout: 30_000 })
    await results.click()
    await page.getByRole('tab', { name: 'Team view', exact: true }).click()
    await page.locator('[data-team-view]').getByText('Ready for team collaboration.', { exact: true }).waitFor()
  })

  afterAll(async () => {
    releaseFirstRequest.resolve(undefined)
    releaseReply.resolve(undefined)
    try {
      await browser?.close()
    } finally {
      try { await scaffold?.close() } finally { hostClock?.mockRestore() }
    }
  })

  it('sends from Team view, separates member/tool messages, streams the answer, and restores history', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-team-view'))
    onTestFinished(() => { releaseFirstRequest.resolve(undefined); releaseReply.resolve(undefined) })
    const view = page.locator('[data-team-view]')
    const input = page.locator('[data-composer-input]').first()
    await input.fill(prompt)
    await input.press('Enter')
    await firstRequest.promise
    await view.locator('[data-kind="thinking"]').waitFor()
    expect(await view.getByText(prompt, { exact: true }).count()).toBe(1)
    await compareOrRefreshGolden(join(SNAPSHOTS, 'thinking.expected.md'), await captureStableAria(page, '[data-team-view]', scaffold.workspaceCwd), MODE)

    releaseFirstRequest.resolve(undefined)
    await replyPrefix.promise
    await view.getByText('TEAM_DIRECT_', { exact: true }).waitFor()
    expect(await view.locator('[data-kind="tool"]').count()).toBeGreaterThanOrEqual(5)
    expect(await view.locator('[data-kind="tool"]').filter({ hasText: 'reviewer' }).count()).toBeGreaterThanOrEqual(1)
    for (const row of await view.locator('[data-kind="tool"]').all()) {
      expect(await row.locator('[data-tool-call]').count()).toBe(1)
    }
    await compareOrRefreshGolden(join(SNAPSHOTS, 'streaming.expected.md'), await captureStableAria(page, '[data-team-view]', scaffold.workspaceCwd), MODE)
    releaseReply.resolve(undefined)
    await view.getByText('TEAM_DIRECT_INBOX_OK', { exact: true }).waitFor()
    await expect.poll(() => scaffold.ctx.agents.get(leadId)?.status).toBe('idle')
    expect(await view.locator('[data-kind="thinking"]').count()).toBe(0)
    await compareOrRefreshGolden(join(SNAPSHOTS, 'settled.expected.md'), await captureStableAria(page, '[data-team-view]', scaffold.workspaceCwd), MODE)

    await input.fill('Keep this draft when switching views')
    await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    await view.waitFor({ state: 'detached' })
    await page.getByRole('tab', { name: 'Team view', exact: true }).click()
    await view.getByText('TEAM_DIRECT_INBOX_OK', { exact: true }).waitFor()
    expect(await input.innerText()).toBe('Keep this draft when switching views')
    await input.fill('')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
    expect(await view.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const tailIsVisible = async (): Promise<boolean> => {
      const tail = await view.getByText('TEAM_DIRECT_INBOX_OK', { exact: true }).boundingBox()
      const composer = await page.locator('[data-composer-seat]').boundingBox()
      return tail !== null && composer !== null && tail.y >= 84 && tail.y + tail.height <= composer.y
    }
    await expect.poll(tailIsVisible).toBe(true)
    await compareOrRefreshGolden(join(SNAPSHOTS, 'mobile.expected.md'), await captureStableAria(page, '[data-team-view]', scaffold.workspaceCwd), MODE)
    await mkdir(join(REPO_ROOT, '.artifacts'), { recursive: true })
    await page.screenshot({ path: join(REPO_ROOT, '.artifacts/team-view-mobile.png') })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expect.poll(tailIsVisible).toBe(true)
    await page.screenshot({ path: join(REPO_ROOT, '.artifacts/team-view.png') })

    await page.reload({ waitUntil: 'load' })
    await page.locator('[data-team-view]').getByText('TEAM_DIRECT_INBOX_OK', { exact: true }).waitFor()
    expect(consoleWatch.pageErrors).toEqual([])
    expect(consoleWatch.warnings).toEqual([])
  })
})
