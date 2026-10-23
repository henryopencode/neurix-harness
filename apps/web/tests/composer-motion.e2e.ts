// First-send geometry over the shipped profile and recorded model turn.
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, writeComposerDraft } from './support.ts'

const fixture = fileURLToPath(new URL('../../../snapshots/web/lifecycle-chrome/session.v3.jsonl', import.meta.url))
const replayOverride = fileURLToPath(new URL('../../../snapshots/web/lifecycle-chrome/replay.override.json', import.meta.url))

it.each(['no-preference', 'reduce'] as const)('docks the existing composer on first send with reduced motion %s', async (reducedMotion) => {
  const scaffold = await launchWebScaffold({ replayFixture: fixture, replayOverride })
  const requested = Promise.withResolvers<undefined>()
  const respond = Promise.withResolvers<undefined>()
  const releaseStream = scaffold.ctx.on('llm/stream', async function* (_options, next) {
    requested.resolve(undefined)
    await respond.promise
    yield* next()
  })
  let browser: Browser | undefined
  try {
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    await page.emulateMedia({ reducedMotion })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const input = page.locator('[data-composer-input]').first()
    await writeComposerDraft(page, input, 'Reply with the single word LIGHTHOUSE and stop.')
    const settled = scaffold.whenTurnSettled()
    const movement = await input.evaluate(async (element, reduce) => {
      const card = element.closest<HTMLElement>('[data-composer-card]')!
      const content = element.closest('[data-conversation-content]')!
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { resolve() })))
      const before = card.getBoundingClientRect().top
      const sampled = new Promise<{
        before: number
        start: number
        middle: number
        end: number
        retained: boolean
        animated: boolean
      }>((resolve, reject) => {
        const timeout = setTimeout(() => {
          observer.disconnect()
          reject(new Error('The first submission did not dock the composer'))
        }, 10_000)
        const observer = new MutationObserver(() => {
          if (content.getAttribute('data-content-phase') !== 'active') return
          const animation = content.getAnimations({ subtree: true }).find(
            candidate => candidate instanceof CSSAnimation && candidate.animationName.includes('composer-dock'),
          )
          if (!reduce && animation === undefined) return
          observer.disconnect()
          clearTimeout(timeout)
          // Sampling the timeline retains intermediate geometry even under CI load.
          animation?.pause()
          if (animation !== undefined) animation.currentTime = 0
          const start = card.getBoundingClientRect().top
          if (animation !== undefined) animation.currentTime = Number(animation.effect!.getTiming().duration) / 2
          const middle = card.getBoundingClientRect().top
          animation?.finish()
          resolve({
            before, start, middle, end: card.getBoundingClientRect().top,
            retained: content.querySelector('[data-composer-input]') === element,
            animated: animation !== undefined,
          })
        })
        observer.observe(content, { attributes: true, subtree: true })
      })
      element.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', bubbles: true, cancelable: true,
      }))
      return sampled
    }, reducedMotion === 'reduce')
    expect(movement.retained).toBe(true)
    expect(movement.end).toBeGreaterThan(movement.before)
    expect(movement.animated).toBe(reducedMotion === 'no-preference')
    if (reducedMotion === 'no-preference') {
      expect(Math.abs(movement.start - movement.before)).toBeLessThan(1)
      expect(movement.middle).toBeGreaterThan(movement.start)
      expect(movement.middle).toBeLessThan(movement.end)
    } else {
      expect(movement.start).toBe(movement.end)
    }
    await requested.promise
    await expect.poll(() => page.locator('[data-composer-entering]').count()).toBe(0)
    const respondingPosition = await page.locator('[data-composer-card]').evaluate(element => element.getBoundingClientRect().bottom)
    respond.resolve(undefined)
    await settled
    await page.locator('[data-composer-stat="usage"]').waitFor()
    const settledPosition = await page.locator('[data-composer-card]').evaluate(element => element.getBoundingClientRect().bottom)
    expect(Math.abs(settledPosition - respondingPosition)).toBeLessThan(1)
    const bottomGap = page.viewportSize()!.height - settledPosition
    await page.setViewportSize({ width: 920, height: 720 })
    const resizedPosition = await page.locator('[data-composer-card]').evaluate(element => element.getBoundingClientRect().bottom)
    expect(Math.abs(720 - resizedPosition - bottomGap)).toBeLessThan(1)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    expect(await page.locator('[data-composer-seat]').evaluate(element => element.getAnimations({ subtree: true }).some(
      animation => animation instanceof CSSAnimation && animation.animationName.includes('composer-dock'),
    ))).toBe(false)
  } finally {
    respond.resolve(undefined)
    releaseStream()
    try {
      await browser?.close()
    } finally {
      await scaffold.close()
    }
  }
})
