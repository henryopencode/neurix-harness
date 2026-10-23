/** Browser-scoped input and software feedback without changing system focus. @module */

import { setTimeout as delay } from 'node:timers/promises'
import type { Page } from 'playwright'
import type { BrowserInputElement } from './browser-observation.ts'
import { z } from 'zod'
import { ComputerError } from './native.ts'
import { scrollBrowserPage } from './browser-scroll.ts'
import { characterLabel, keyLabel, typeCharacters } from './feedback.ts'
import type { WindowFeedbackEvent } from './feedback.ts'
import { showBrowserFeedback } from './browser-overlay.ts'
import type { ComputerInput } from './schema.ts'
import type { ResolvedConfig } from './index.ts'

const viewportSize = z.object({ width: z.number().positive(), height: z.number().positive() })

type BrowserInput = Extract<ComputerInput, { action: 'move' | 'click' | 'type' | 'key' | 'scroll' | 'drag' }>

/**
 * Route input to one page while leaving the user's OS pointer and focus alone.
 * @param page - exact Agent-owned page.
 * @param input - validated pointer or keyboard operation.
 * @param locator - exact observed element, including a verified focused editor.
 * @param config - captured pacing and feedback choices.
 * @param signal - owning operation deadline and cancellation.
 * @param dispatch - reserves cancellation ownership only while input is in flight.
 * @param destination - optional observed drop target; its rectangle is read before mouse-down.
 * @param display - independent window display; omitted only for a headless or non-macOS page.
 * @returns after delivery; the caller observes the resulting page state.
 */
export async function backgroundBrowserAction(
  page: Page, input: BrowserInput, locator: BrowserInputElement | undefined, config: ResolvedConfig,
  signal: AbortSignal, dispatch: <T>(work: () => Promise<T>) => Promise<T>, destination?: BrowserInputElement,
  display?: (event: WindowFeedbackEvent) => Promise<void>,
): Promise<void> {
  const feedback = async (event: WindowFeedbackEvent) => {
    if (!config.showOverlay) return
    if (display !== undefined) await display(event)
    else await showBrowserFeedback(page, event)
  }
  let point: { x: number; y: number } | undefined
  if (locator !== undefined) {
    if (input.action !== 'scroll') await locator.scrollIntoViewIfNeeded({ timeout: config.operationTimeoutMs })
    const bounds = await locator.boundingBox()
    if (bounds === null) throw new ComputerError('ELEMENT_NOT_VISIBLE', 'The observed element is not visible.', 'none', 'Observe the page and choose a visible element.')
    if (input.action === 'scroll') {
      const viewport = viewportSize.parse(await page.evaluate('({ width: innerWidth, height: innerHeight })'))
      const left = Math.max(0, bounds.x), right = Math.min(viewport.width, bounds.x + bounds.width)
      const top = Math.max(0, bounds.y), bottom = Math.min(viewport.height, bounds.y + bounds.height)
      if (right <= left || bottom <= top) throw new ComputerError('ELEMENT_NOT_VISIBLE', 'The scroll target is outside the viewport.', 'none',
        'Observe and select a visible scrolling region.')
      point = { x: (left + right) / 2, y: (top + bottom) / 2 }
    } else point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  } else if ('x' in input && input.x !== undefined && 'y' in input && input.y !== undefined) point = { x: input.x, y: input.y }
  if (point !== undefined) {
    await feedback({ ...point, durationMs: config.cursorMoveDurationMs, idleMs: config.overlayIdleMs })
    if (display === undefined && config.showOverlay && config.cursorMoveDurationMs > 0) {
      await delay(config.cursorMoveDurationMs, undefined, { signal })
    }
  }
  const requirePoint = () => {
    if (point === undefined) throw new ComputerError('LOCATOR_REQUIRED', 'This action needs an observed locator or screenshot point.', 'none', 'Select the returned field locator or a point in a fresh screenshot.')
    return point
  }
  signal.throwIfAborted()
  switch (input.action) {
    case 'move': {
      const at = requirePoint()
      await page.mouse.move(at.x, at.y)
      return
    }
    case 'click': {
      // The runtime deadline owns dispatch; an opened dialog can outlive this call.
      if (locator !== undefined) await dispatch(() => locator.click({ button: input.button, clickCount: input.count, timeout: 0 }))
      else {
        const at = requirePoint()
        await dispatch(() => page.mouse.click(at.x, at.y, { button: input.button, clickCount: input.count }))
      }
      await feedback({ click: true, idleMs: config.overlayIdleMs })
      return
    }
    case 'type': {
      if (locator !== undefined) await locator.focus()
      else { const at = requirePoint(); await dispatch(() => page.mouse.click(at.x, at.y)) }
      const editor = locator ?? page.locator(':focus')
      if (!await editor.isEditable()) throw new ComputerError('EDITABLE_FIELD_REQUIRED', 'The selected target is not editable.', 'possible', 'Observe and select the intended input field.')
      if (input.replace) await dispatch(() => editor.fill(''))
      await feedback({ typing: true, hold: true, idleMs: config.overlayIdleMs })
      let key: string | undefined
      try {
        await typeCharacters(input.text, config.typingDelayMs, async (character) => {
          await dispatch(() => page.keyboard.insertText(character))
          key = characterLabel(character)
          await feedback({ typing: true, key, hold: true, idleMs: config.overlayIdleMs })
        }, signal)
      } finally {
        if (!page.isClosed()) await feedback({ typing: true, ...key === undefined ? {} : { key },
          hold: false, idleMs: config.overlayIdleMs })
      }
      return
    }
    case 'key': {
      await feedback({ keys: input.keys.map(key => keyLabel([key])), idleMs: config.overlayIdleMs })
      const names: Record<string, string> = { cmd: 'Meta', command: 'Meta', meta: 'Meta', ctrl: 'Control', control: 'Control', alt: 'Alt', option: 'Alt',
        shift: 'Shift', enter: 'Enter', return: 'Enter', escape: 'Escape', tab: 'Tab', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }
      await dispatch(() => page.keyboard.press(input.keys.map(key => names[key.toLowerCase()] ?? key).join('+')))
      return
    }
    case 'scroll': {
      const at = requirePoint()
      await page.mouse.move(at.x, at.y)
      await feedback({ scroll: input.direction, hold: true, idleMs: config.overlayIdleMs })
      try {
        await dispatch(() => scrollBrowserPage(page, at, input, config.scrollDurationMs, signal))
        await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      } finally {
        if (!page.isClosed()) await feedback({ scroll: input.direction, hold: false, idleMs: config.overlayIdleMs })
      }
      return
    }
    case 'drag': {
      if (destination !== undefined && (input.toX !== undefined || input.toY !== undefined)) {
        throw new ComputerError('AMBIGUOUS_ADDRESS', 'Choose a drop locator or drop coordinates.', 'none', 'Use exactly one destination addressing method.')
      }
      let end: { x: number; y: number }
      if (destination !== undefined) {
        const bounds = await destination.boundingBox()
        if (bounds === null) throw new ComputerError('ELEMENT_NOT_VISIBLE', 'The drop target is not visible.', 'none', 'Observe the page and choose a visible drop target.')
        end = { x: bounds.x + bounds.width * input.toPosition.x, y: bounds.y + bounds.height * input.toPosition.y }
      } else {
        if (input.toX === undefined || input.toY === undefined) throw new ComputerError('DESTINATION_REQUIRED',
          'Dragging needs toLocator or both toX and toY.', 'none', 'Use the exact drop locator from geometry.elements.')
        end = { x: input.toX, y: input.toY }
      }
      const viewport = viewportSize.parse(await page.evaluate('({ width: innerWidth, height: innerHeight })'))
      if (locator !== undefined) {
        const source = await locator.boundingBox()
        if (source === null) throw new ComputerError('ELEMENT_NOT_VISIBLE', 'The drag source is not visible.', 'none', 'Observe the page and choose a visible source.')
        point = { x: source.x + source.width / 2, y: source.y + source.height / 2 }
      }
      const at = requirePoint()
      if ([at, end].some(point => point.x < 0 || point.y < 0 || point.x >= viewport.width || point.y >= viewport.height)) {
        throw new ComputerError('POINT_OUTSIDE_VIEWPORT', 'Both drag endpoints must be in the visible viewport.', 'none',
          'Scroll until both targets are visible, observe, then use their returned locators.')
      }
      await page.mouse.move(at.x, at.y)
      await feedback({ ...at, durationMs: 0, idleMs: config.overlayIdleMs })
      await dispatch(async () => {
        try {
          await page.mouse.down()
          await feedback({ pressed: true, idleMs: config.overlayIdleMs })
          const steps = Math.max(1, Math.ceil(config.cursorMoveDurationMs / (1000 / 60)))
          for (let step = 1; step <= steps; step++) {
            signal.throwIfAborted()
            const progress = step / steps
            const point = { x: at.x + (end.x - at.x) * progress, y: at.y + (end.y - at.y) * progress }
            await page.mouse.move(point.x, point.y)
            await feedback({ ...point, idleMs: config.overlayIdleMs })
            if (config.cursorMoveDurationMs > 0) await delay(config.cursorMoveDurationMs / steps, undefined, { signal })
          }
        } finally {
          if (!page.isClosed()) {
            try { await page.mouse.up() } finally { await feedback({ pressed: false, click: true, idleMs: config.overlayIdleMs }) }
          }
        }
      })
      return
    }
  }
}
