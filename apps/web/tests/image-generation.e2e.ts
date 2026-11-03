/** Real Web configuration, Images API acquisition, durable previews, and plugin deactivation. */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterEach, describe, expect, it, onTestFailed } from 'vitest'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspaceZh, expandTurnProcesses, openSettings, PLUGIN_TOGGLE_SETTLE_MS, saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/session/generate-image/session.v4.jsonl', import.meta.url))
const MINIMAX_FIXTURE = fileURLToPath(new URL('../../../snapshots/session/generate-image-minimax/session.v4.jsonl', import.meta.url))
const MULTIPLE_FIXTURE = fileURLToPath(new URL('../../../snapshots/session/generate-image-multiple/session.v4.jsonl', import.meta.url))
const FAILURE_FIXTURE = fileURLToPath(new URL('../../../snapshots/session/generate-image-minimax-failures/session.v4.jsonl', import.meta.url))

describe('web e2e: image generation', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page

  afterEach(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    browser = undefined
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    scaffold = undefined
    if (failures.length) throw new AggregateError(failures, 'image-generation browser teardown failed')
  })

  it.skipIf(webSnapshotMode() === 'record').each([
    { provider: 'openai', reply: 'path' },
    { provider: 'minimax', reply: 'path' },
    { provider: 'minimax', reply: 'placeholder' },
    { provider: 'minimax', reply: 'multiple' },
  ] as const)('$provider/$reply: configures generation, displays saved images after reload, and removes the disabled tool', async ({ provider, reply }) => {
    const endpoint = provider === 'minimax'
      ? 'https://minimax-images-fixture.invalid/v1/image_generation'
      : 'https://images-fixture.invalid/v1/images/generations'
    const model = provider === 'minimax' ? 'image-01' : 'fixture-image-model'
    const replayFixture = reply === 'multiple' ? MULTIPLE_FIXTURE
      : provider === 'minimax' && reply === 'path' ? MINIMAX_FIXTURE : FIXTURE
    const defaultRatio = provider === 'minimax' && reply === 'path' ? '16:9' : '1:1'
    scaffold = await launchWebScaffold({
      replayFixture, compareReplaySession: false,
      ...reply !== 'path' ? {} : {
        replayOverride: fileURLToPath(new URL('./fixtures/image-generation-reply.json', import.meta.url)),
      },
      extraOverlayPath: [
        fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
        fileURLToPath(new URL('./image-generation-provider.overlay.yml', import.meta.url)),
      ],
      profile: { packages: [{ dir: fileURLToPath(new URL('../../../packages/image-generation/image-generation-bundle', import.meta.url)) }] },
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    const consoleWatch = watchConsole(page)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-image-generation'))
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)

    await openSettings(page, 'zh')
    const settings = page.getByRole('dialog', { name: '设置', exact: true })
    expect(await settings.getByRole('button', { name: '图像生成', exact: true }).count()).toBe(0)
    await page.keyboard.press('Escape')
    await page.getByRole('navigation', { name: '全局面板' }).getByRole('button', { name: '插件', exact: true }).click()
    const panel = page.locator('[data-plugin-panel]')
    const tools = panel.locator('[data-plugin-group="tools"]')
    await tools.getByRole('heading', { name: '扩展工具', exact: true }).waitFor({ timeout: 20_000 })
    expect(await tools.getByRole('button', { name: '查看 图像生成', exact: true }).count()).toBe(1)
    expect(await tools.getByText('已停用', { exact: true }).count()).toBe(1)
    if (provider === 'openai' && reply === 'path') {
      const snapshot = await captureStableAria(page, '[data-plugin-group="tools"]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(fileURLToPath(new URL('./expected/image-generation/tools.expected.md', import.meta.url)), snapshot, webSnapshotMode())
    }
    await tools.getByRole('button', { name: '查看 图像生成', exact: true }).click()
    const form = panel.locator('[data-plugin-config]')
    expect(scaffold.ctx.tools.schemas().map(tool => tool.name)).not.toContain('generate_image')
    await panel.getByRole('switch', { name: '启用 图像生成', exact: true }).click()
    await form.getByLabel('生图接口地址', { exact: true }).waitFor({ timeout: 20_000 })
    expect(await panel.locator('[data-detail-document]').count()).toBe(0)
    expect(scaffold.ctx.tools.schemas().map(tool => tool.name)).not.toContain('generate_image')
    if (provider === 'minimax') {
      await scaffold.ctx.settings.update('tool-image-generation', { provider: 'minimax' })
      await expect.poll(() => form.getByLabel('图片质量', { exact: true }).count()).toBe(0)
    }
    expect(await form.getByRole('tablist').count()).toBe(0)
    expect(await form.getByText(/MiniMax/u).count()).toBe(0)
    await form.getByLabel('启用对话生图', { exact: true }).check()
    expect(await form.getByRole('button', { name: '保存', exact: true }).isDisabled()).toBe(true)
    await form.getByLabel('生图接口地址', { exact: true }).fill(endpoint)
    await form.getByLabel('图片模型', { exact: true }).fill(model)
    if (provider === 'minimax') await form.getByRole('combobox', { name: '默认图片比例', exact: true }).selectOption(defaultRatio)
    const apiKey = form.getByLabel('API Key', { exact: true })
    expect(await apiKey.getAttribute('type')).toBe('password')
    await apiKey.fill('fixture-key')
    await form.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => scaffold!.ctx.tools.schemas().map(tool => tool.name), { timeout: PLUGIN_TOGGLE_SETTLE_MS }).toContain('generate_image')
    const generationSchema = scaffold.ctx.tools.schemas().find(tool => tool.name === 'generate_image')!.parameters
    if (provider === 'minimax') {
      expect(generationSchema).not.toHaveProperty('properties.quality')
      expect(generationSchema).toHaveProperty('properties.size.description', expect.stringContaining('16:9'))
    } else {
      expect(generationSchema).toHaveProperty('properties.quality')
    }
    await expect.poll(() => apiKey.inputValue()).toBe('')
    expect(await form.getByText('已配置', { exact: true }).count()).toBe(1)
    expect(await form.getByText('已覆盖', { exact: true }).count()).toBe(0)
    expect(await form.getByRole('button', { name: '恢复默认', exact: true }).count()).toBe(0)
    if (provider === 'openai' && reply === 'path') {
      const snapshot = await captureStableAria(page, '[data-plugin-detail]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(fileURLToPath(new URL('./expected/image-generation/configuration.expected.md', import.meta.url)), snapshot, webSnapshotMode())
    }
    if (provider === 'minimax' && reply === 'path') {
      expect(await form.getByRole('combobox', { name: '默认图片比例', exact: true }).inputValue()).toBe(defaultRatio)
      const snapshot = await captureStableAria(page, '[data-plugin-config]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(fileURLToPath(new URL('./expected/image-generation/ratios.expected.md', import.meta.url)), snapshot, webSnapshotMode())
    }
    const document = await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')
    expect(document).toContain(model)
    if (provider === 'minimax') expect(document).toContain('provider: minimax')
    expect(document).toContain('enabled: true')
    const redacted = scaffold.ctx.settings.describe({ redactSecrets: true })
    expect(JSON.stringify(redacted)).not.toContain('fixture-key')

    await panel.getByRole('button', { name: '返回插件', exact: true }).click()
    expect(await tools.getByRole('switch', { name: '启用 图像生成', exact: true }).isChecked()).toBe(true)
    expect(await tools.getByText('已配置', { exact: true }).count()).toBe(0)
    await tools.getByRole('button', { name: '查看 图像生成', exact: true }).click()
    await expect.poll(() => form.getByLabel('生图接口地址', { exact: true }).inputValue()).toBe(endpoint)
    await expect.poll(() => panel.getByLabel('图片模型', { exact: true }).inputValue()).toBe(model)
    expect(await panel.getByText('已配置', { exact: true }).count()).toBe(1)

    for (const colorScheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme })
      await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe(colorScheme === 'dark' ? '' : null)
      expect(await panel.getByLabel('生图接口地址', { exact: true }).isVisible()).toBe(true)
    }
    await page.reload({ waitUntil: 'load' })
    await page.locator('[data-composer-input][contenteditable="true"]').first().waitFor({ timeout: 20_000 })
    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input]').first()
    const user = parseSessionLog(await readFile(replayFixture, 'utf8'))
      .find(event => event.type === 'user/message' && event.data.source.kind === 'user')
    if (user?.type !== 'user/message') throw new Error('image fixture has no user task')
    await input.fill(user.data.content.map(block => block.type === 'text' ? block.text : '').join(''))
    await input.press('Enter')
    const sessionId = await settled
    const generated = scaffold.ctx.sessions.get(sessionId)?.snapshotEvents().find(event => event.type === 'tool/result')
    if (generated?.type !== 'tool/result') throw new Error('image-generation tool result missing')
    expect(generated.data.message.isError).toBe(false)
    const savedImage = generated.data.message.content.find(part => part.type === 'image')
    if (savedImage?.type !== 'image') throw new Error('image-generation attachment missing')
    const finalImage = page.getByRole('img', { name: 'Generated image 1', exact: true })
    await finalImage.waitFor({ timeout: 20_000 })
    await expect.poll(() => finalImage.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
    const source = new URL((await finalImage.getAttribute('src'))!)
    if (reply !== 'path') expect(source.protocol).toBe('blob:')
    else {
      expect(source.pathname).toBe('/api/file')
      expect(source.searchParams.get('path')).toBe(scaffold.ctx.attachments.imageHostPath(savedImage.attachment))
    }
    if (reply === 'multiple') {
      // Keyboard activation avoids hit-test rounding between the recorded 1px images.
      await page.getByRole('button', { name: '查看大图: Generated image 1', exact: true }).press('Enter')
    } else await finalImage.click()
    await page.getByRole('dialog', { name: '图片预览', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    if (reply === 'multiple') {
      const sources: string[] = []
      for (let index = 1; index <= 4; index++) {
        const preview = page.getByRole('img', { name: `Generated image ${index}`, exact: true })
        await preview.waitFor({ timeout: 20_000 })
        await expect.poll(() => preview.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
        sources.push((await preview.getAttribute('src'))!)
      }
      expect(new Set(sources).size).toBe(4)
    }
    await expandTurnProcesses(page)
    const image = page.getByRole('img', { name: 'generated-1.png', exact: true })
    try { await image.waitFor({ timeout: 20_000 }) }
    catch (error: unknown) {
      await saveFailureShot(page, 'web-e2e-image-generation')
      throw error
    }
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
    expect(await image.getAttribute('src')).toMatch(/^blob:/u)
    await image.click()
    await page.getByRole('dialog', { name: '原图预览', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await expect.poll(() => page.getByRole('dialog', { name: '原图预览', exact: true }).count()).toBe(0)
    await page.reload({ waitUntil: 'load' })
    await finalImage.waitFor({ timeout: 20_000 })
    await expect.poll(() => finalImage.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
    if (reply === 'multiple') {
      for (let index = 2; index <= 4; index++) {
        const preview = page.getByRole('img', { name: `Generated image ${index}`, exact: true })
        await preview.waitFor({ timeout: 20_000 })
        await expect.poll(() => preview.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
      }
    }
    await expandTurnProcesses(page)
    await image.waitFor({ timeout: 20_000 })
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)

    await page.getByRole('navigation', { name: '全局面板' }).getByRole('button', { name: '插件', exact: true }).click()
    await tools.getByRole('button', { name: '查看 图像生成', exact: true }).click()
    await form.getByLabel('生图接口地址', { exact: true }).waitFor({ timeout: 20_000 })
    expect(await apiKey.inputValue()).toBe('')
    expect(await form.getByLabel('生图接口地址', { exact: true }).inputValue()).toBe(endpoint)
    await panel.getByRole('button', { name: '返回插件', exact: true }).click()
    const card = tools.locator('[data-plugin-package="@deepseek-ai/dsh-image-generation-bundle"]')
    await card.evaluate((element) => {
      const observer = new MutationObserver((records) => {
        if (records.some(record => Array.from(record.addedNodes).some(node => node.textContent?.includes('待配置')))) {
          element.setAttribute('data-setup-flashed', '')
        }
        const toggle = element.querySelector('[role="switch"]')
        if (toggle?.getAttribute('aria-checked') === 'false' && !toggle.hasAttribute('disabled')) observer.disconnect()
      })
      observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-checked', 'disabled'] })
    })
    await tools.getByRole('switch', { name: '启用 图像生成', exact: true }).click()
    await expect.poll(() => scaffold!.ctx.tools.schemas().map(tool => tool.name), { timeout: PLUGIN_TOGGLE_SETTLE_MS }).not.toContain('generate_image')
    await expect.poll(() => tools.getByRole('switch', { name: '启用 图像生成', exact: true }).isChecked(), { timeout: PLUGIN_TOGGLE_SETTLE_MS }).toBe(false)
    await expect.poll(() => tools.getByRole('switch', { name: '启用 图像生成', exact: true }).isEnabled(), { timeout: PLUGIN_TOGGLE_SETTLE_MS }).toBe(true)
    expect(await card.getAttribute('data-setup-flashed')).toBeNull()
    expect(await tools.getByText('已停用', { exact: true }).count()).toBe(1)
    expect(await tools.getByRole('button', { name: '查看 图像生成', exact: true }).isVisible()).toBe(true)
    expect(consoleWatch.pageErrors).toEqual([])
  }, 120_000)

  it.skipIf(webSnapshotMode() === 'record')('MiniMax: stops after three errors, preserves the failures after reload, and accepts a new message', async () => {
    scaffold = await launchWebScaffold({
      replayFixture: FAILURE_FIXTURE, compareReplaySession: false,
      extraOverlayPath: [
        fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
        fileURLToPath(new URL('../../../snapshots/session/generate-image-minimax-failures/cordis.yml', import.meta.url)),
      ],
      profile: { packages: [{ dir: fileURLToPath(new URL('../../../packages/image-generation/image-generation-bundle', import.meta.url)) }] },
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    const consoleWatch = watchConsole(page)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-image-generation-failure-limit'))
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
    const user = parseSessionLog(await readFile(FAILURE_FIXTURE, 'utf8'))
      .find(event => event.type === 'user/message' && event.data.source.kind === 'user')
    if (user?.type !== 'user/message') throw new Error('image failure fixture has no user task')
    const task = user.data.content.map(block => block.type === 'text' ? block.text : '').join('')
    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input]').first()
    await input.fill(task)
    await input.press('Enter')
    const sessionId = await settled
    const events = scaffold.ctx.sessions.get(sessionId)?.snapshotEvents() ?? []
    expect(events.filter(event => event.type === 'assistant/message')).toHaveLength(3)
    expect(events.filter(event => event.type === 'tool/call')).toHaveLength(3)
    const failures = events.filter(event => event.type === 'tool/result')
    expect(failures).toHaveLength(3)
    expect(failures.every(event => event.data.message.isError && event.data.error?.code === 'IMAGE_GENERATION_PROVIDER_ERROR')).toBe(true)
    const ending = events.find(event => event.type === 'turn/end')
    expect(ending?.data.reason).toMatchObject({ kind: 'aborted', reason: { kind: 'hook' } })
    const reason = ending?.data.reason
    if (reason?.kind !== 'aborted' || reason.reason.kind !== 'hook') throw new Error('image failure limit did not stop the Web turn')
    expect(reason.reason.reason).toContain('failed 3 times')
    await expandTurnProcesses(page)
    await page.getByRole('button', { name: '已停止', exact: true }).waitFor()
    await expect.poll(() => page.getByText(/^Error: MiniMax image generation failed \(code 1008\)/u).count()).toBe(3)
    await page.reload({ waitUntil: 'load' })
    await expandTurnProcesses(page)
    await page.getByRole('button', { name: '已停止', exact: true }).waitFor()
    await expect.poll(() => page.getByText(/^Error: MiniMax image generation failed \(code 1008\)/u).count()).toBe(3)
    await input.fill('Ready for a new image request.')
    expect(await input.textContent()).toBe('Ready for a new image request.')
    expect(consoleWatch.pageErrors).toEqual([])
  }, 60_000)
})
