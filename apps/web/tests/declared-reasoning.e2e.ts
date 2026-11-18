// Web e2e scenario: a hand-declared model's `reasoningEfforts` reaches the
// composer's effort pane — the levels a settings profile declares are exactly
// what the picker offers, and picking one records it with the Agent default.
// Zero model calls: declaring, describing, and switching are settings/llm
// traffic only, so there is no fixture and a stray stream would fail loud.
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page, Request } from 'playwright'
import { chromium, webkit } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, onTestFinished } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

/** Starts the shipped default on this scenario's declared reasoning model. */
const OVERLAY = fileURLToPath(new URL('./declared-reasoning.overlay.yml', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/declared-reasoning', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./expected/declared-reasoning/ui.expected.md', import.meta.url))
const POINTER_EXPECTED = fileURLToPath(new URL('./expected/declared-reasoning/pointer-menu.expected.md', import.meta.url))
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record').each([
  { name: 'Chromium', engine: chromium },
  { name: 'WebKit', engine: webkit },
])('web e2e: declared reasoning efforts reach the composer ($name)', ({ engine }) => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    // The whole reasoning offer is the profile: key = selectable level, value
    // = the wire spelling dispatch would send (`max: ultra` renames; the
    // valueless `off` means "supported, send nothing"). The route sets no
    // deployment default, so the pane leads with the provider-default entry.
    await scaffold.ctx.settings.update('llm-pi-ai', {
      providers: {
        'acme-gateway': {
          displayName: 'Acme Gateway',
          api: 'openai-completions',
          baseURL: 'https://gateway.acme.example/v1',
          models: [
            { id: 'acme-think', name: 'Acme Think' },
            { id: 'acme-swift', name: 'Acme Swift' },
            { id: 'acme-lite', name: 'Acme Lite' },
          ].map(model => ({
            ...model,
            reasoningEfforts: { off: null, high: 'high', max: 'ultra' },
          })),
        },
      },
    })
    browser = await engine.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      await scaffold?.close()
    }
  })

  it('offers exactly the declared levels and records the picked one', async () => {
    onTestFailed(() => saveFailureShot(page, `web-e2e-declared-reasoning-${engine.name()}`))
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    await trigger.waitFor({ timeout: 15_000 })
    await trigger.click()
    await page.getByRole('menuitem', { name: /推理等级/ }).click()

    // Declared levels, nothing else: the provider-default entry (the route
    // configures no `reasoning`), then Off/High/Max — minimal, low, medium,
    // and xhigh were not declared and must not be offered.
    const levels = page.getByRole('menuitemradio')
    await expect.poll(async () => levels.allTextContents(), { timeout: 10_000 })
      .toEqual(['Default', 'Off', 'High', 'Max'])
    const snapshot = await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)

    // Keyboard: the clicked cell unmounts with its pane, so the drilled pane's
    // checked row takes the focus it left behind. ↑↓ walk the rows from there
    // and Tab settles the focused one exactly as Enter would.
    await expect.poll(
      () => levels.nth(0).evaluate(element => element === document.activeElement),
      { timeout: 10_000 },
    ).toBe(true)
    await page.keyboard.press('ArrowDown')
    await expect.poll(
      () => levels.nth(1).evaluate(element => element === document.activeElement),
      { timeout: 10_000 },
    ).toBe(true)
    await page.keyboard.press('ArrowDown')
    await expect.poll(
      () => levels.nth(2).evaluate(element => element === document.activeElement),
      { timeout: 10_000 },
    ).toBe(true)

    // Settling with Tab is the same gesture that saves the default selection, so
    // the effort lands in the Agent default Settings section beside provider/model.
    await page.keyboard.press('Tab')
    await expect.poll(() => levels.count(), { timeout: 10_000 }).toBe(0)
    await expect.poll(
      async () => readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8'),
      { timeout: 10_000 },
    ).toContain('reasoningEffort: high')
    await expect.poll(() => trigger.getAttribute('aria-label'), { timeout: 10_000 })
      .toBe('选择模型，当前 Acme Think，推理等级 High')

    // Reopening the drilled pane parks the keyboard on the level in use, and
    // Shift+Tab walks back out like Escape: to the drilled cell, then closed.
    await trigger.click()
    await page.getByRole('menuitem', { name: /推理等级/ }).click()
    const high = page.getByRole('menuitemradio', { name: 'High' })
    await expect.poll(
      () => high.evaluate(element => element === document.activeElement),
      { timeout: 10_000 },
    ).toBe(true)
    await page.keyboard.press('Shift+Tab')
    await expect.poll(
      () => page.getByRole('menuitem', { name: /推理等级/ })
        .evaluate(element => element === document.activeElement),
      { timeout: 10_000 },
    ).toBe(true)
    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => page.getByRole('menu').count(), { timeout: 10_000 }).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('opens from the pointer with keyboard focus and closes from the trigger in every pane', async () => {
    onTestFailed(() => saveFailureShot(page, `web-e2e-model-trigger-${engine.name()}`))
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    const menu = page.getByRole('menu')
    for (const pane of ['root', 'model', 'effort']) {
      await page.locator('[data-composer-input][contenteditable="true"]').focus()
      await trigger.click()
      await expect.poll(() => trigger.evaluate(element => element === document.activeElement)).toBe(true)
      if (pane === 'root') {
        await page.keyboard.press('ArrowDown')
        await expect.poll(() => page.getByRole('menuitem', { name: /^模型/ })
          .evaluate(element => element === document.activeElement)).toBe(true)
      } else {
        await page.getByRole('menuitem', { name: pane === 'model' ? /^模型/ : /推理等级/ }).click()
        const focused = pane === 'model'
          ? page.getByRole('searchbox', { name: '搜索模型…' })
          : page.locator('[role="menuitemradio"][aria-checked="true"]')
        await expect.poll(() => focused.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
      }
      await trigger.click()
      await menu.waitFor({ state: 'detached' })
      await expect.poll(() => trigger.evaluate(element => element === document.activeElement)).toBe(true)
    }
    expect(tripwire.pageErrors).toEqual([])
  })

  it('selects model and effort by mouse and keeps keyboard control after cancelled or rejected clicks', async () => {
    onTestFailed(() => saveFailureShot(page, `web-e2e-model-pointer-${engine.name()}`))
    let selections = 0
    const countSelection = (request: Request): void => {
      if (new URL(request.url()).pathname.endsWith('/session/selectModel')) selections++
    }
    page.on('request', countSelection)
    onTestFinished(() => { page.off('request', countSelection) })
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    const menu = page.getByRole('menu')
    await trigger.click()
    await page.getByRole('menuitem', { name: /^模型/ }).click()
    const current = page.getByRole('menuitemradio', { name: 'Acme Think', exact: true })
    const target = page.getByRole('menuitemradio', { name: 'Acme Swift', exact: true })
    const search = page.getByRole('searchbox', { name: '搜索模型…' })
    await expect.poll(() => search.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
    expect(await search.getAttribute('aria-activedescendant')).toBe(await current.getAttribute('id'))

    // Native mousedown must not blur search and unmount the menu before click in WebKit.
    await target.getByText('Acme Swift', { exact: true }).hover()
    await page.mouse.down()
    try {
      await expect.poll(() => menu.count()).toBe(1)
      await expect.poll(() => search.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
      await page.getByText('Acme Gateway', { exact: true }).hover()
    } finally {
      await page.mouse.up()
    }
    // Later selection counts also include any request from this cancelled press.
    expect(selections).toBe(0)
    await search.press('ArrowUp')
    expect(await search.getAttribute('aria-activedescendant')).toBe(await current.getAttribute('id'))
    await search.press('ArrowDown')
    expect(await search.getAttribute('aria-activedescendant')).toBe(await target.getAttribute('id'))
    await expect.poll(() => search.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Shift+Tab')
    await menu.waitFor({ state: 'detached' })

    await trigger.click()
    await page.getByRole('menuitem', { name: /^模型/ }).click()
    await target.getByText('Acme Swift', { exact: true }).click()
    await menu.waitFor({ state: 'detached' })
    expect(selections).toBe(1)
    await expect.poll(() => scaffold.ctx.agentDefaultModel.currentSelection().model, { timeout: 10_000 })
      .toBe('acme-swift')

    await trigger.click()
    await page.getByRole('menuitem', { name: /推理等级/ }).click()
    await page.getByRole('menuitemradio', { name: 'Max', exact: true }).click()
    await menu.waitFor({ state: 'detached' })
    expect(selections).toBe(2)
    await expect.poll(() => scaffold.ctx.agentDefaultModel.currentSelection().reasoningEffort, { timeout: 10_000 })
      .toBe('max')

    await page.route('**/api/session/selectModel', async (route) => {
      const envelope = route.request().postDataJSON() as { rpcId: string }
      await route.fulfill({
        json: {
          type: 'server-response', rpcId: envelope.rpcId,
          result: {
            ok: false,
            error: { code: 'session/writer-held', message: 'writer held', details: { sessionId: 'held-session' } },
          },
        },
      })
    }, { times: 1 })
    await trigger.click()
    await page.getByRole('menuitem', { name: /^模型/ }).click()
    await expect.poll(() => search.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
    expect(await search.getAttribute('aria-activedescendant')).toBe(await target.getAttribute('id'))
    await current.click()
    await page.getByRole('alert').waitFor()
    expect(selections).toBe(3)
    await compareOrRefreshGolden(POINTER_EXPECTED,
      await captureStableAria(page, '[role="group"][aria-label="模型与推理等级"]', scaffold.workspaceCwd), MODE)
    await expect.poll(() => trigger.evaluate(element => element === document.activeElement)).toBe(true)
    await page.keyboard.press('Tab')
    await expect.poll(() => search.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
    expect(await search.getAttribute('aria-activedescendant')).toBe(await target.getAttribute('id'))
    await search.press('ArrowUp')
    expect(await search.getAttribute('aria-activedescendant')).toBe(await current.getAttribute('id'))
    expect(await search.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'detached' })

    await trigger.click()
    await page.getByRole('menuitem', { name: /^模型/ }).click()
    await page.locator('[data-composer-input][contenteditable="true"]').focus()
    await menu.waitFor({ state: 'detached' })
    await trigger.click()
    await page.mouse.click(0, 0)
    await menu.waitFor({ state: 'detached' })
    expect(tripwire.pageErrors).toEqual([])
  })

  it('previews native slider drags and keeps the popover inside desktop and narrow viewports', async () => {
    onTestFailed(() => saveFailureShot(page, `web-e2e-model-slider-${engine.name()}`))
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    const menu = page.getByRole('menu', { name: '模型与推理等级' })
    await page.getByRole('alert').waitFor({ state: 'detached' })
    await trigger.click()
    await page.getByRole('menuitem', { name: /^模型/ }).click()
    await page.getByRole('menuitemradio', { name: 'Acme Swift', exact: true }).click()
    await trigger.click()
    await page.getByRole('menuitem', { name: /推理等级/ }).click()
    await page.getByRole('menuitemradio', { name: 'Max', exact: true }).click()
    await menu.waitFor({ state: 'detached' })

    let selections = 0
    const countSelection = (request: Request): void => {
      if (new URL(request.url()).pathname.endsWith('/session/selectModel')) selections++
    }
    page.on('request', countSelection)
    onTestFinished(() => { page.off('request', countSelection) })
    await trigger.click()
    const slider = page.getByRole('slider', { name: '推理等级' })
    await expect.poll(() => slider.getAttribute('aria-valuetext')).toBe('Max')
    const rect = await slider.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    })
    await page.mouse.move(rect.x + rect.width - 14, rect.y + rect.height / 2)
    await page.mouse.down()
    try {
      await page.mouse.move(rect.x + 14 + (rect.width - 28) * 2 / 3, rect.y + rect.height / 2, { steps: 6 })
      await expect.poll(() => slider.evaluateAll(elements => elements[0]?.getAttribute('aria-valuetext'))).toBe('High')
      expect(selections).toBe(0)
    } finally {
      await page.mouse.up()
    }
    await menu.waitFor({ state: 'detached' })
    expect(selections).toBe(1)
    await expect.poll(() => trigger.getAttribute('aria-label')).toContain('推理等级 High')
    await trigger.click()
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'slider.expected.md'),
      await captureStableAria(page, '[role="menu"][aria-label="模型与推理等级"]', scaffold.workspaceCwd), MODE)
    const shots = process.env['DSH_MODEL_SELECTOR_SHOTS'] === '1'
      ? await mkdtemp(join(tmpdir(), `dsh-model-selector-${engine.name()}-`))
      : undefined
    onTestFinished(async () => {
      await page.setViewportSize({ width: 1680, height: 1000 })
      await page.emulateMedia({ colorScheme: null })
    })
    for (const width of [1680, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme })
        await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme')))
          .toBe(colorScheme === 'dark')
        const layout = await menu.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          const entries = Array.from(element.querySelectorAll('[role="menuitem"]')).map(item => item.getBoundingClientRect())
          const range = element.querySelector('input[type="range"]')!
          const rangeBounds = range.getBoundingClientRect()
          return {
            left: bounds.left, right: bounds.right, width: bounds.width,
            effortAboveModel: entries[1]!.bottom <= entries[0]!.top,
            centered: entries.every(entry => Math.abs((entry.left + entry.right - bounds.left - bounds.right) / 2) < 1),
            sliderContained: rangeBounds.left >= bounds.left && rangeBounds.right <= bounds.right,
            thumb: getComputedStyle(range).getPropertyValue('--dsw-alias-slider-thumb').trim(),
          }
        })
        expect(layout).toMatchObject({ width: 280, effortAboveModel: true, centered: true, sliderContained: true, thumb: '#fff' })
        expect(layout.left).toBeGreaterThanOrEqual(12)
        expect(layout.right).toBeLessThanOrEqual(width - 12)
        if (shots !== undefined) await page.screenshot({ path: join(shots, `${width}-${colorScheme}.png`) })
      }
    }
    if (shots !== undefined) console.info(`Model selector screenshots: ${shots}`)
    await slider.press('Home')
    await menu.waitFor({ state: 'detached' })
    expect(selections).toBe(2)
    await expect.poll(() => trigger.getAttribute('aria-label')).toContain('推理等级 Default')

    await trigger.click()
    const outsideDrag = await slider.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    })
    await page.mouse.move(outsideDrag.x + 14, outsideDrag.y + outsideDrag.height / 2)
    await page.mouse.down()
    try {
      await page.mouse.move(outsideDrag.x + outsideDrag.width + 24, outsideDrag.y + outsideDrag.height / 2, { steps: 6 })
      await expect.poll(() => slider.evaluateAll(elements => elements[0]?.getAttribute('aria-valuetext'))).toBe('Max')
      expect(selections).toBe(2)
    } finally {
      await page.mouse.up()
    }
    await menu.waitFor({ state: 'detached' })
    expect(selections).toBe(3)
    await expect.poll(() => trigger.getAttribute('aria-label')).toContain('推理等级 Max')
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md', 'pointer-menu.expected.md', 'slider.expected.md'])
  })
})
