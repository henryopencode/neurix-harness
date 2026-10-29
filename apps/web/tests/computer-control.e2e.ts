/** Real plugin settings, approval decisions, browser ownership, preview interactions, and unload. */

import { fileURLToPath } from 'node:url'
import { readFile, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { z } from 'zod'
import type { Browser } from 'playwright'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode } from './scaffold.ts'
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
    response.end(`<title>Computer Plugin UI Test</title>
      <style>body{margin:0;min-width:1280px;min-height:860px}.corner{position:absolute;width:40px;height:40px}
      #right{left:1240px;top:0;background:#ff0000}#bottom{left:0;top:820px;background:#00ff00}
      #opposite{left:1240px;top:820px;background:#0000ff}</style>
      <h1>Plugin-owned real browser</h1><p>Approval and preview test page</p>
      <div class="corner" id="right" aria-label="Right edge marker"></div>
      <div class="corner" id="bottom" aria-label="Bottom edge marker"></div>
      <div class="corner" id="opposite" aria-label="Opposite corner marker"></div>`)
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
      profile: { packages: [{ dir: fileURLToPath(new URL('../../../packages/experimental/browser-control', import.meta.url)) }] },
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
    expect(await panel.locator('[data-plugin-package="@deepseek-ai/dsh-experimental-browser-control"]').getByText('实验性', { exact: true }).count()).toBe(0)
    await panel.getByRole('button', { name: '查看 浏览器操作', exact: true }).click()
    await panel.getByRole('switch', { name: '启用 浏览器操作', exact: true }).click()
    const form = panel.locator('[data-plugin-config]')
    await form.getByLabel('浏览器', { exact: true }).waitFor()
    expect(await form.getByLabel('操作模式', { exact: true }).count()).toBe(0)
    expect(await form.getByLabel('原生应用控件读取预算（毫秒）', { exact: true }).count()).toBe(0)
    expect(await form.getByLabel('显示 Agent 独立光标与按键提示', { exact: true }).count()).toBe(0)
    expect(await form.getByLabel('附带截图', { exact: true }).isChecked()).toBe(false)
    expect(await form.getByLabel('隐藏浏览器窗口', { exact: true }).count()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/browser-control/settings.expected.md', import.meta.url)),
      await captureStableAria(page, '[data-plugin-config]', active.workspaceCwd), webSnapshotMode())
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect.poll(() => form.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
    expect(await form.locator('textarea').count()).toBe(0)
    expect(await panel.locator('[data-detail-document]').count()).toBe(0)
    expect(await form.getByLabel('逐字输入间隔（毫秒）', { exact: true }).count()).toBe(0)
    await form.getByText('高级设置', { exact: true }).click()
    await form.getByLabel('操作超时（毫秒）', { exact: true }).fill('20000')
    await form.getByLabel('每次浏览器操作前确认', { exact: true }).check()
    await form.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFile(join(active.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8'))
      .toContain('requireInputApproval: true')
    await expect.poll(() => active.ctx.tools.schemas().map(tool => tool.name), { timeout: PLUGIN_TOGGLE_SETTLE_MS }).toContain('browser')
    await page.reload({ waitUntil: 'load' })
    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    await input.waitFor({ timeout: 20_000 })
    const rejected = active.whenTurnSettled(90_000)
    await input.fill('Open the test page with browser; I will reject this action.')
    await input.press('Enter')
    await page.getByRole('button', { name: '拒绝', exact: true }).click()
    const rejectedSession = await rejected
    const rejectedEvents = active.ctx.sessions.get(rejectedSession)?.snapshotEvents() ?? []
    expect(rejectedEvents.some(event => event.type === 'approval/decided' && event.data.outcome === 'rejected')).toBe(true)
    expect(requests).toBe(0)
    if (process.platform === 'darwin') expect(await ownedChromeProcesses()).toHaveLength(0)
    // Approval, browser startup, and persistence share this wait; startup alone can consume 30 seconds.
    const settled = active.whenTurnSettled(90_000)
    await input.fill('Open a blank browser tab with browser and show its preview.')
    await input.press('Enter')
    const allow = page.getByRole('button', { name: '允许一次', exact: true })
    await allow.waitFor()
    expect(await page.getByRole('button', { name: '显示浏览器画中画', exact: true }).count()).toBe(0)
    await allow.click()
    const sessionId = await settled
    const events = active.ctx.sessions.get(sessionId)?.snapshotEvents() ?? []
    expect(events.some(event => event.type === 'approval/decided' && event.data.outcome === 'allowed-once')).toBe(true)
    expect(events.some(event => event.type === 'tool/result' && !event.data.message.isError),
      JSON.stringify(events.filter(event => event.type === 'tool/result'))).toBe(true)
    const opened = events.findLast(event => event.type === 'tool/result')
    if (opened?.type !== 'tool/result' || opened.data.message.isError) throw new Error('The browser failed to open')
    const browserState = opened.data.message.content.find(block => block.type === 'text')
    if (browserState?.type !== 'text') throw new Error('The browser returned no viewport state')
    expect(z.object({ geometry: z.object({ viewport: z.object({ width: z.number(), height: z.number() }) }) })
      .parse(JSON.parse(browserState.text)).geometry.viewport).toEqual({ width: 1440, height: 900 })
    await expect.poll(() => requests).toBe(1)
    if (process.platform === 'darwin') await expect.poll(ownedChromeProcesses).toHaveLength(1)
    const preview = page.locator('[data-computer-preview]')
    const image = preview.getByRole('img')
    await image.waitFor({ timeout: 20_000 })
    expect(await page.getByRole('button', { name: '隐藏浏览器画中画', exact: true }).count()).toBe(0)
    expect(await preview.getByRole('button', { name: '关闭画中画', exact: true }).count()).toBe(0)
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
    const source = await image.getAttribute('src')
    if (source === null || !source.startsWith('data:image/png;base64,')) throw new Error('The preview has no PNG capture')
    const png = Buffer.from(source.slice('data:image/png;base64,'.length), 'base64')
    const pixels = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(pixels.info).toMatchObject({ width: 640, height: 400, channels: 3 })
    // The fixture's right, bottom and opposite markers sit outside Chrome's old 756×469 viewport.
    for (const [x, y, expected] of [[1260, 20, [255, 0, 0]], [20, 840, [0, 255, 0]], [1260, 840, [0, 0, 255]]] as const) {
      const offset = (Math.round(y * 400 / 900) * 640 + Math.round(x * 640 / 1440)) * 3
      expect([...pixels.data.subarray(offset, offset + 3)]).toEqual(expected)
    }
    const firstCapture = source
    await expect.poll(() => image.getAttribute('src')).not.toBeNull()
    const sessionPreview = active.ctx.get('browserPreview')
    if (sessionPreview === undefined) throw new Error('Browser preview Remote did not mount')
    for (let index = 0; index < 3; index++) {
      const current = await sessionPreview.frame(sessionId, new AbortController().signal)
      if (current.frame.kind !== 'frame') throw new Error('Repeated browser capture was unavailable')
      const metadata = await sharp(Buffer.from(current.frame.imageUrl.split(',')[1] ?? '', 'base64')).metadata()
      expect({ width: metadata.width, height: metadata.height }).toEqual({ width: 640, height: 400 })
    }
    expect(firstCapture).toBeTruthy()
    // The entrance animation scales the rendered rectangle; compare layout widths.
    const width = await preview.evaluate(element => element.clientWidth)
    await preview.hover()
    const maximize = preview.getByRole('button', { name: '最大化', exact: true })
    const maximizeIcon = await maximize.locator('svg').getAttribute('data-icon')
    await maximize.click()
    await expect.poll(() => preview.boundingBox()).toEqual({ x: 0, y: 0, width: 1440, height: 1000 })
    expect(await preview.getByRole('button', { name: '还原', exact: true }).locator('svg').getAttribute('data-icon')).not.toBe(maximizeIcon)
    const maximizedImage = await image.boundingBox()
    if (maximizedImage === null) throw new Error('The maximized image has no visible rectangle')
    expect(maximizedImage.width / maximizedImage.height).toBeCloseTo(1.6, 2)
    expect(maximizedImage.x + maximizedImage.width / 2).toBeCloseTo(720, 1)
    expect(maximizedImage.y + maximizedImage.height / 2).toBeCloseTo(500, 1)
    await page.setViewportSize({ width: 390, height: 700 })
    await expect.poll(() => preview.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 700 })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await preview.hover()
    await preview.getByRole('button', { name: '还原', exact: true }).click()
    await expect.poll(() => preview.evaluate(element => element.clientWidth)).toBe(width)
    const handle = await preview.getByRole('button', { name: '拖动画中画', exact: true }).boundingBox()
    const before = await preview.boundingBox()
    if (handle === null || before === null) throw new Error('Computer preview has no drag geometry')
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2 - 120, handle.y + handle.height / 2 + 80, { steps: 6 })
    await page.mouse.up()
    await expect.poll(async () => (await preview.boundingBox())?.x).toBeLessThan(before.x)
    const original = await preview.boundingBox()
    const resize = await preview.getByRole('button', { name: '从左下角调整画中画大小', exact: true }).boundingBox()
    if (original === null || resize === null) throw new Error('Computer preview has no resize geometry')
    await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2)
    await page.mouse.down()
    await page.mouse.move(resize.x + resize.width / 2 - 150, resize.y + resize.height / 2 + 90, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => (await preview.boundingBox())?.width).toBeGreaterThan(original.width + 100)
    const resized = await preview.boundingBox()
    if (resized === null) throw new Error('Resized preview has no geometry')
    expect(resized.x + resized.width).toBeCloseTo(original.x + original.width, 0)
    expect(resized.width / resized.height).toBeCloseTo(original.width / original.height, 2)
    const imageBounds = await image.boundingBox()
    if (imageBounds === null) throw new Error('The resized image has no visible rectangle')
    expect(imageBounds.width).toBeCloseTo(resized.width, 1)
    expect(imageBounds.height).toBeCloseTo(resized.height, 1)
    const keyboardResize = preview.getByRole('button', { name: '从右下角调整画中画大小', exact: true })
    await keyboardResize.press('ArrowRight')
    await expect.poll(async () => (await preview.boundingBox())?.width).toBeGreaterThan(resized.width)
    await page.setViewportSize({ width: 390, height: 700 })
    await expect.poll(() => preview.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return box.left >= 15 && box.right <= innerWidth - 15 && box.top >= 16 && box.bottom <= innerHeight - 15
    })).toBe(true)
    expect(await keyboardResize.evaluate(element => element === document.activeElement)).toBe(true)
    await page.setViewportSize({ width: 1440, height: 1000 })
    const floating = await preview.boundingBox()
    if (floating === null) throw new Error('The floating preview has no geometry')
    for (const [x, y] of [[0, 0], [1439, 999]] as const) {
      const target = await preview.getByRole('button', { name: '拖动画中画', exact: true }).boundingBox()
      if (target === null) throw new Error('The preview has no drag target')
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2)
      await page.mouse.down()
      await page.mouse.move(x, y, { steps: 6 })
      await page.mouse.up()
      const moved = await preview.boundingBox()
      if (moved === null) throw new Error('The dragged preview has no geometry')
      expect(moved.width).toBeCloseTo(floating.width, 1)
      expect(moved.height).toBeCloseTo(floating.height, 1)
      if (x === 0) {
        expect(moved.x).toBeCloseTo(16, 1)
        expect(moved.y).toBeCloseTo(16, 1)
      } else {
        expect(moved.x + moved.width).toBeCloseTo(1440 - 16, 1)
        expect(moved.y + moved.height).toBeCloseTo(1000 - 16, 1)
      }
    }
    const restored = await preview.boundingBox()
    await preview.hover()
    await preview.getByRole('button', { name: '最大化', exact: true }).click()
    await preview.getByRole('button', { name: '还原', exact: true }).press('Escape')
    expect(await preview.boundingBox()).toEqual(restored)
    await preview.hover()
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/browser-control/preview.expected.md', import.meta.url)),
      await captureStableAria(page, '[data-computer-preview]', active.workspaceCwd), webSnapshotMode())
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
    await preview.getByRole('button', { name: '收起', exact: true }).click()
    expect(await image.count()).toBe(0)
    expect(await preview.getByRole('button', { name: '展开', exact: true }).count()).toBe(1)
    const plugins = await openPlugins()
    const detail = plugins.locator('[data-plugin-config]')
    if (await detail.count() === 0) await plugins.getByRole('button', { name: '查看 浏览器操作', exact: true }).click()
    await detail.getByLabel('每次浏览器操作前确认', { exact: true }).uncheck()
    await detail.getByText('高级设置', { exact: true }).click()
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
    expect(finalResult?.data.message.content.find(block => block.type === 'text')?.text).toContain('"inputMode":"background"')
    expect(after.filter(event => event.type === 'approval/decided')).toHaveLength(2)
    const calls = after.filter(event => event.type === 'tool/call')
    expect(calls.map(event => z.object({ action: z.string() }).parse(JSON.parse(event.data.arguments)).action))
      .toEqual(['open_browser', 'open_browser', 'new_tab'])
    if (await preview.count() !== 0 && await preview.getAttribute('data-collapsed') === null) {
      await preview.hover()
      await preview.getByRole('button', { name: '收起', exact: true }).click()
    }
    const finalPanel = await openPlugins()
    if (await finalPanel.locator('[data-plugin-config]').count() === 0) {
      await finalPanel.getByRole('button', { name: '查看 浏览器操作', exact: true }).click()
    }
    await finalPanel.getByRole('switch', { name: '启用 浏览器操作', exact: true }).click()
    await expect.poll(() => active.ctx.tools.schemas().map(tool => tool.name), { timeout: PLUGIN_TOGGLE_SETTLE_MS }).not.toContain('browser')
    await expect.poll(() => preview.count()).toBe(0)
    await active.ctx.loader.await()
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
