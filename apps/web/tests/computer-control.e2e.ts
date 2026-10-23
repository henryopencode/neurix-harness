/** Real plugin settings, approval decisions, browser ownership, preview interactions, and unload. */

import { fileURLToPath } from 'node:url'
import { readFile, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { Browser } from 'playwright'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspaceZh, PLUGIN_TOGGLE_SETTLE_MS, ZH_BROWSER_LOCALE } from './support.ts'

async function ownedChromeProcesses(): Promise<number[]> {
  const result = await promisify(execFile)('/bin/ps', ['-axo', 'pid=,ppid=,comm='])
  return result.stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line)
    return match !== null && Number(match[2]) === process.pid && match[3]?.endsWith('/Google Chrome') ? [Number(match[1])] : []
  })
}

it.skipIf(webSnapshotMode() === 'record')('validates settings, rejects and approves real browser actions, operates the preview, applies live policy, and unloads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-computer-ui-'))
  let requests = 0
  const server = createServer((request, response) => {
    if (request.url === '/') requests++
    response.setHeader('content-type', 'text/html')
    response.end('<title>Computer Plugin UI Test</title><h1>Plugin-owned real browser</h1><p>Approval and preview test page</p>')
  })
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  const failures: unknown[] = []
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Computer UI fixture did not bind a port')
    const override = join(root, 'computer-control-browser.json')
    await writeFile(override, (await readFile(new URL('./fixtures/computer-control-browser.json', import.meta.url), 'utf8'))
      .replaceAll('about:blank', `http://127.0.0.1:${address.port}/`))
    const active = await launchWebScaffold({
      replayFixture: fileURLToPath(new URL('../../../snapshots/session/computer-use-unified/session.v4.jsonl', import.meta.url)),
      replayOverride: override,
      compareReplaySession: false,
      extraOverlayPath: fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
      profile: { packages: [{ dir: fileURLToPath(new URL('../../../packages/experimental/computer-control', import.meta.url)) }] },
    })
    scaffold = active
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    const consoleWatch = watchConsole(page)
    await page.goto(active.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, active.workspaceCwd)
    const openPlugins = async () => {
      await page.getByRole('navigation', { name: '全局面板' }).getByRole('button', { name: '插件', exact: true }).click()
      return page.locator('[data-plugin-panel]')
    }
    const panel = await openPlugins()
    expect(await panel.locator('[data-plugin-package="@deepseek-ai/dsh-experimental-computer-control"]').getByText('实验性', { exact: true }).count()).toBe(0)
    await panel.getByRole('button', { name: '查看 电脑控制', exact: true }).click()
    await panel.getByRole('switch', { name: '启用 电脑控制', exact: true }).click()
    const form = panel.locator('[data-plugin-config]')
    expect(await form.getByLabel('操作模式', { exact: true }).inputValue()).toBe('background')
    expect(await form.getByLabel('操作模式', { exact: true }).locator('option[value="background"]').textContent()).toBe('网页后台')
    expect(await form.getByLabel('附带截图', { exact: true }).isChecked()).toBe(false)
    expect(await panel.getByLabel('1. 检查权限和窗口', { exact: true }).inputValue()).toContain('列出当前窗口')
    expect(await panel.getByLabel('2. 测试浏览器', { exact: true }).inputValue()).toContain('第二个标签页')
    expect(await panel.getByLabel('3. 测试 macOS 应用', { exact: true }).inputValue()).toContain('不要保存')
    const characterDelay = form.getByLabel('逐字输入间隔（毫秒）', { exact: true })
    await characterDelay.fill('201')
    await expect.poll(() => characterDelay.getAttribute('aria-invalid')).toBe('true')
    expect(await form.getByRole('button', { name: '保存', exact: true }).isEnabled()).toBe(false)
    await characterDelay.fill('45')
    await form.getByLabel('操作模式', { exact: true }).selectOption('foreground')
    await form.getByLabel('操作模式', { exact: true }).selectOption('background')
    await form.getByLabel('操作超时（毫秒）', { exact: true }).fill('20000')
    await form.getByLabel('隐藏浏览器窗口', { exact: true }).check()
    await form.getByLabel('显示 Agent 独立光标与按键提示', { exact: true }).uncheck()
    await form.getByLabel('每次电脑操作前确认', { exact: true }).check()
    await form.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFile(join(active.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8'))
      .toContain('requireInputApproval: true')
    await expect.poll(() => active.ctx.tools.schemas().map(tool => tool.name), { timeout: PLUGIN_TOGGLE_SETTLE_MS }).toContain('computer')
    await page.reload({ waitUntil: 'load' })
    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    await input.waitFor({ timeout: 20_000 })
    const rejected = active.whenTurnSettled(90_000)
    await input.fill('Open the test page with computer; I will reject this action.')
    await input.press('Enter')
    await page.getByRole('button', { name: '拒绝', exact: true }).click()
    const rejectedSession = await rejected
    const rejectedEvents = active.ctx.sessions.get(rejectedSession)?.snapshotEvents() ?? []
    expect(rejectedEvents.some(event => event.type === 'approval/decided' && event.data.outcome === 'rejected')).toBe(true)
    expect(requests).toBe(0)
    if (process.platform === 'darwin') expect(await ownedChromeProcesses()).toHaveLength(0)
    // Approval, browser startup, and persistence share this wait; startup alone can consume 30 seconds.
    const settled = active.whenTurnSettled(90_000)
    await input.fill('Open a blank browser tab with computer and show its preview.')
    await input.press('Enter')
    const allow = page.getByRole('button', { name: '允许一次', exact: true })
    await allow.waitFor()
    await page.getByRole('button', { name: '显示电脑画中画', exact: true }).click()
    await allow.click()
    const sessionId = await settled
    const events = active.ctx.sessions.get(sessionId)?.snapshotEvents() ?? []
    expect(events.some(event => event.type === 'approval/decided' && event.data.outcome === 'allowed-once')).toBe(true)
    expect(events.some(event => event.type === 'tool/result' && !event.data.message.isError)).toBe(true)
    await expect.poll(() => requests).toBe(1)
    if (process.platform === 'darwin') await expect.poll(ownedChromeProcesses).toHaveLength(1)
    const preview = page.locator('[data-computer-preview]')
    const image = preview.getByRole('img')
    await image.waitFor({ timeout: 20_000 })
    expect(await page.getByRole('button', { name: '隐藏电脑画中画', exact: true }).getAttribute('aria-pressed')).toBe('true')
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
    const width = await preview.evaluate(element => element.getBoundingClientRect().width)
    await preview.hover()
    await preview.getByRole('button', { name: '放大', exact: true }).click()
    await expect.poll(() => preview.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(width)
    await preview.hover()
    await preview.getByRole('button', { name: '还原', exact: true }).click()
    await expect.poll(() => preview.evaluate(element => element.getBoundingClientRect().width)).toBe(width)
    const handle = await preview.getByRole('button', { name: '拖动画中画', exact: true }).boundingBox()
    const before = await preview.boundingBox()
    if (handle === null || before === null) throw new Error('Computer preview has no drag geometry')
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2 - 120, handle.y + handle.height / 2 + 80, { steps: 6 })
    await page.mouse.up()
    await expect.poll(async () => (await preview.boundingBox())?.x).toBeLessThan(before.x)
    const artifacts = process.env.DSH_COMPUTER_USE_ARTIFACT_DIR
    if (artifacts !== undefined) {
      await mkdir(artifacts, { recursive: true })
      await page.screenshot({ path: join(artifacts, 'computer-plugin-preview.png') })
    }
    await preview.hover()
    await preview.getByRole('button', { name: '收起', exact: true }).click()
    await preview.getByRole('button', { name: '展开', exact: true }).click()
    await image.waitFor()
    await preview.hover()
    await preview.getByRole('button', { name: '关闭画中画', exact: true }).click()
    await expect.poll(() => preview.count()).toBe(0)
    const plugins = await openPlugins()
    const detail = plugins.locator('[data-plugin-config]')
    if (await detail.count() === 0) await plugins.getByRole('button', { name: '查看 电脑控制', exact: true }).click()
    await detail.getByLabel('每次电脑操作前确认', { exact: true }).uncheck()
    await detail.getByLabel('操作模式', { exact: true }).selectOption('foreground')
    expect(await detail.getByText('已覆盖', { exact: true }).count()).toBe(0)
    expect(await detail.getByRole('button', { name: '恢复默认', exact: true }).count()).toBe(0)
    await detail.getByLabel('操作超时（毫秒）', { exact: true }).fill('15000')
    expect(await detail.getByLabel('操作超时（毫秒）', { exact: true }).inputValue()).toBe('15000')
    await detail.getByRole('button', { name: '保存', exact: true }).click()
    await page.reload({ waitUntil: 'load' })
    await input.waitFor({ timeout: 20_000 })
    const nextTurn = active.whenTurnSettled(90_000)
    await input.fill('Open a second test tab; input approval is now disabled.')
    await input.press('Enter')
    expect(await nextTurn).toBe(sessionId)
    await expect.poll(() => requests).toBe(2)
    const after = active.ctx.sessions.get(sessionId)?.snapshotEvents() ?? []
    const finalResult = after.filter(event => event.type === 'tool/result').at(-1)
    expect(finalResult?.data.message.content.find(block => block.type === 'text')?.text).toContain('"inputMode":"foreground"')
    expect(after.filter(event => event.type === 'approval/decided')).toHaveLength(2)
    const calls = after.filter(event => event.type === 'tool/call')
    expect(calls.map(event => z.object({ action: z.string() }).parse(JSON.parse(event.data.arguments)).action))
      .toEqual(['open_browser', 'open_browser', 'new_tab'])
    if (await preview.count() !== 0) {
      await preview.hover()
      await preview.getByRole('button', { name: '关闭画中画', exact: true }).click()
    }
    const finalPanel = await openPlugins()
    if (await finalPanel.locator('[data-plugin-config]').count() === 0) {
      await finalPanel.getByRole('button', { name: '查看 电脑控制', exact: true }).click()
    }
    await finalPanel.getByRole('switch', { name: '启用 电脑控制', exact: true }).click()
    await expect.poll(() => active.ctx.tools.schemas().map(tool => tool.name), { timeout: PLUGIN_TOGGLE_SETTLE_MS }).not.toContain('computer')
    if (process.platform === 'darwin') {
      await expect.poll(ownedChromeProcesses, { timeout: PLUGIN_TOGGLE_SETTLE_MS }).toHaveLength(0)
    }
    expect(consoleWatch.warnings).toEqual([])
    expect(consoleWatch.pageErrors).toEqual([])
  } catch (error) {
    failures.push(error)
    const artifacts = process.env.DSH_COMPUTER_USE_ARTIFACT_DIR
    const page = browser?.contexts()[0]?.pages()[0]
    if (artifacts !== undefined && page !== undefined) {
      try { await page.screenshot({ path: join(artifacts, 'computer-plugin-failure.png') }) } catch (captureError) {
        failures.push(captureError)
      }
    }
  } finally {
    try { await browser?.close() } catch (error) { failures.push(error) }
    try { await scaffold?.close() } catch (error) { failures.push(error) }
    try {
      try {
        server.closeAllConnections()
        if (server.listening) await new Promise<void>((resolve, reject) => {
          server.close((error) => { if (error) reject(error); else resolve() })
        })
      } finally { await rm(root, { recursive: true, force: true }) }
    } catch (error) { failures.push(error) }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'Computer UI test and cleanup failures')
})
