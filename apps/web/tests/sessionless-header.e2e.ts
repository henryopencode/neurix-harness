/** Global navigation before the first Session, through the shipped Web composition. */
import { chromium, type Browser, type Locator, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'
import { initialShortcutConfig } from '@deepseek-ai/dsh-client-shortcuts/protocol'

let scaffold: WebScaffold
let browser: Browser

beforeAll(async () => {
  scaffold = await launchWebScaffold()
  browser = await chromium.launch()
})

afterAll(async () => {
  try { await browser?.close() }
  finally { await scaffold?.close() }
})

async function sidebarMotion(page: Page, toggle: Locator): Promise<{ from: number; middle: number; to: number }> {
  const observation = await page.evaluateHandle(() => {
    const frame = document.querySelector<HTMLElement>('[style*="grid-template-columns"]')
    if (frame === null) throw new Error('sidebar frame is not mounted')
    const from = Number.parseFloat(getComputedStyle(frame).gridTemplateColumns)
    const controller = new AbortController()
    const state = { result: null as { from: number; middle: number; to: number } | null,
      dispose: () => { controller.abort() } }
    frame.addEventListener('transitionrun', (event) => {
      if (event.target !== frame || event.propertyName !== 'grid-template-columns') return
      const animation = frame.getAnimations().find(item =>
        'transitionProperty' in item && item.transitionProperty === 'grid-template-columns')
      if (animation === undefined) throw new Error('sidebar track has no active transition')
      const duration = animation.effect?.getComputedTiming().duration
      if (typeof duration !== 'number' || duration <= 0) throw new Error('sidebar transition has no duration')
      animation.pause()
      animation.currentTime = duration / 2
      state.result = { from, middle: Number.parseFloat(getComputedStyle(frame).gridTemplateColumns),
        to: Number.parseFloat(frame.style.gridTemplateColumns) }
      animation.finish()
      controller.abort()
    }, { signal: controller.signal })
    return state
  })
  try {
    await toggle.click()
    await expect.poll(() => observation.evaluate(state => state.result), { timeout: 10_000 }).not.toBeNull()
    return await observation.evaluate((state) => {
      if (state.result === null) throw new Error('sidebar did not produce a transition')
      return state.result
    })
  } finally {
    await observation.evaluate((state) => { state.dispose() })
    await observation.dispose()
  }
}

describe('navigation without a selected Session', () => {
  it.each(['web', 'win32', 'linux', 'darwin'] as const)('%s preserves its empty-header geometry and sidebar access', async (platform) => {
    const page = await newEnglishPage(browser)
    try {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      if (platform !== 'web') {
        await page.addInitScript(({ value, snapshot }) => {
          Object.assign(window, { dshDesktop: { protocolVersion: 1,
            keyboard: { subscribe: () => () => {}, closeWindow: async () => {} },
            shortcuts: { get: async () => ({ ...snapshot, status: 'ready' }),
              subscribe: () => () => {}, recording: async () => {},
              edit: async () => ({ status: 'not-ready', snapshot }) },
          } })
          const mark = () => { document.documentElement.setAttribute('data-platform', value) }
          if (document.documentElement === null) document.addEventListener('DOMContentLoaded', mark, { once: true })
          else mark()
        }, { value: platform, snapshot: initialShortcutConfig() })
      }
      const tripwire = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.getByRole('textbox', { name: 'Choose workspace', exact: true }).waitFor()
      const sessionHeader = page.locator('[data-slot="conversation.session.header"]')
      expect(await sessionHeader.count()).toBe(0)
      const header = page.locator('[data-slot="conversation.header"] > header')
      expect(await header.evaluate(element => element.getBoundingClientRect().height)).toBe(platform === 'darwin' ? 40 : 0)
      const closing = await sidebarMotion(page, page.getByRole('button', { name: 'Collapse sidebar', exact: true }))
      expect(closing.from).toBe(280)
      expect(closing.to).toBe(platform === 'darwin' ? 0 : 56)
      expect(closing.middle).toBeGreaterThan(closing.to)
      expect(closing.middle).toBeLessThan(closing.from)
      const reopen = platform === 'darwin'
        ? page.locator('[data-shell-leading]').getByRole('button', { name: 'Open sidebar', exact: true })
        : page.getByRole('button', { name: 'Open sidebar', exact: true })
      await reopen.waitFor({ state: 'visible' })
      expect(await sessionHeader.count()).toBe(0)
      expect(await header.evaluate(element => element.getBoundingClientRect().height)).toBe(platform === 'darwin' ? 40 : 0)
      if (platform === 'darwin') {
        expect(await page.locator('[data-shell-leading]').getByRole('button', { name: 'New session', exact: true }).isVisible()).toBe(true)
      }
      // The open label precedes both the column slide and the rail's mount animation.
      // Reverse the pointer action only after the rendered sidebar has settled.
      const sidebarSettled = () => page.locator('[data-sidebar-collapsed]').evaluate((frame: HTMLElement) =>
        Number.parseFloat(getComputedStyle(frame).gridTemplateColumns) === Number.parseFloat(frame.style.gridTemplateColumns)
        && frame.getAnimations({ subtree: true }).every(animation => animation.playState === 'finished' || animation.playState === 'idle'))
      await expect.poll(sidebarSettled, { timeout: 30_000 }).toBe(true)
      const opening = await sidebarMotion(page, reopen)
      expect(opening.from).toBe(closing.to)
      expect(opening.to).toBe(280)
      expect(opening.middle).toBeGreaterThan(opening.from)
      expect(opening.middle).toBeLessThan(opening.to)
      await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).waitFor({ state: 'visible' })
      expect(await sessionHeader.count()).toBe(0)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    } catch (error) {
      await saveFailureShot(page, `sessionless-header-${platform}`)
      throw error
    } finally {
      await page.close()
    }
  })
})
