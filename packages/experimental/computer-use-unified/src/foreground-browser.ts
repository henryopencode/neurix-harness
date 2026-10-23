/** Browser locators resolve geometry; foreground delivery uses system input. @module */

import type { Page } from 'playwright'
import type { BrowserInputElement } from './browser-observation.ts'
import { ComputerError } from './native.ts'
import type { ComputerInput } from './schema.ts'
import type { ResolvedConfig } from './index.ts'
import type { ForegroundTarget } from './foreground.ts'
import { scrollBrowserPage } from './browser-scroll.ts'

type Input = Extract<ComputerInput, { action: 'move' | 'click' | 'type' | 'key' | 'scroll' | 'drag' }>
type Viewport = {
  pid: number
  windowId: number
  bounds: ForegroundTarget['bounds']
  content: ForegroundTarget['bounds']
  scaleX: number
  scaleY: number
  viewport: { width: number; height: number }
}

/**
 * Resolve current DOM rectangles into native screen points before mouse-down.
 * @param page - exact owned tab, already selected for foreground delivery.
 * @param input - validated pointer or keyboard action.
 * @param locator - selected element or verified focused editor.
 * @param destination - optional exact drag destination.
 * @param window - native content rectangle and screenshot calibration.
 * @param config - captured input pacing.
 * @param signal - owning cancellation and deadline.
 * @returns one native target; browser scroll retains the continuous gesture engine.
 */
export async function foregroundBrowserTarget(page: Page, input: Input, locator: BrowserInputElement | undefined,
  destination: BrowserInputElement | undefined, window: Viewport, config: ResolvedConfig, signal: AbortSignal): Promise<ForegroundTarget> {
  let point: { x: number; y: number } | undefined
  let focusedEditor = false
  if (locator !== undefined) {
    if (input.action !== 'scroll') await locator.scrollIntoViewIfNeeded({ timeout: config.operationTimeoutMs })
    const rect = await locator.boundingBox()
    if (rect === null) throw new ComputerError('ELEMENT_NOT_VISIBLE', 'The selected element is not visible.', 'none', 'Observe the page and choose a visible element.')
    const left = Math.max(0, rect.x), right = Math.min(window.viewport.width, rect.x + rect.width)
    const top = Math.max(0, rect.y), bottom = Math.min(window.viewport.height, rect.y + rect.height)
    if (right <= left || bottom <= top) throw new ComputerError('ELEMENT_NOT_VISIBLE', 'The selected element is outside the viewport.',
      'none', 'Observe the page and choose a visible element.')
    point = { x: (left + right) / 2, y: (top + bottom) / 2 }
    if (input.action === 'type' && !await locator.isEditable()) throw new ComputerError('EDITABLE_FIELD_REQUIRED',
      'The selected element is not editable.', 'none', 'Observe the page and select the intended editor.')
    if (input.action === 'type') focusedEditor = await locator.evaluate(element => element === element.ownerDocument.activeElement)
  } else if ('x' in input && input.x !== undefined && input.y !== undefined) point = { x: input.x, y: input.y }
  let end: { x: number; y: number } | undefined
  if (input.action === 'drag') {
    if (destination !== undefined) {
      if (input.toX !== undefined || input.toY !== undefined) throw new ComputerError('AMBIGUOUS_ADDRESS',
        'Choose a drop locator or coordinates.', 'none', 'Use exactly one destination address.')
      const rect = await destination.boundingBox()
      if (rect === null) throw new ComputerError('ELEMENT_NOT_VISIBLE', 'The drop target is not visible.', 'none', 'Observe the page and select a visible destination.')
      end = { x: rect.x + rect.width * input.toPosition.x, y: rect.y + rect.height * input.toPosition.y }
    } else if (input.toX !== undefined && input.toY !== undefined) end = { x: input.toX, y: input.toY }
  }
  for (const at of [point, end]) {
    if (at !== undefined && (at.x < 0 || at.y < 0 || at.x >= window.viewport.width || at.y >= window.viewport.height)) {
      throw new ComputerError('POINT_OUTSIDE_VIEWPORT', 'Both endpoints must be inside the current viewport.', 'none',
        'Scroll until both targets are visible and observe the page again.')
    }
  }
  const screen = (at: { x: number; y: number }) => ({ x: window.content.x + at.x * window.content.width / window.viewport.width,
    y: window.content.y + at.y * window.content.height / window.viewport.height })
  const at = point
  return { owner: input.target, pid: window.pid, windowId: window.windowId, bounds: window.bounds, focus: 'accessibility',
    scaleX: window.scaleX, scaleY: window.scaleY, capture: window.content,
    ...point === undefined || focusedEditor ? {} : { point: screen(point) },
    ...end === undefined ? {} : { destination: screen(end) },
    ...input.action !== 'scroll' || at === undefined ? {} : { wheel: async () => {
      await scrollBrowserPage(page, at, input, config.scrollDurationMs, signal)
      await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    } },
  }
}
