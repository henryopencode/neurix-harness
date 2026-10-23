/** Browser element identities retained from the last rendered observation. @module */

import type { JSHandle, Locator, Page } from 'playwright'
import { ComputerError } from './native.ts'

/** Page-owned identities; navigation destroys the handle and requires observation. */
export type BrowserObservedElements = JSHandle<{ elements: readonly unknown[]; focused: unknown }>

/** Exact observed DOM node used until one input operation settles. */
export type BrowserPinnedElement = NonNullable<Awaited<ReturnType<Locator['elementHandle']>>>

/** Semantic addressing or an exact observed node accepted by browser input helpers. */
export type BrowserInputElement = Pick<Locator, 'click' | 'fill' | 'focus' | 'scrollIntoViewIfNeeded' | 'boundingBox' | 'isEditable'> & {
  evaluate(work: (element: HTMLElement | SVGElement) => boolean): Promise<boolean>
}

/**
 * Retain the actual nodes described by the observation, without exposing a page-global registry.
 * @param page - exact owned tab.
 * @param selectors - exact selectors returned with rendered geometry and visible editors.
 * @returns a handle released by the next observation or page closure.
 */
export async function captureBrowserElements(page: Pick<Page, 'evaluateHandle'>, selectors: readonly string[]): Promise<BrowserObservedElements> {
  return page.evaluateHandle(`({ elements: ${JSON.stringify(selectors)}.flatMap(selector => Array.from(document.querySelectorAll(selector))), focused: document.activeElement })`)
}

/**
 * Reject unobserved or replaced nodes before input, including implicit editor changes.
 * @param locator - current semantic or exact locator.
 * @param observed - identities retained by the latest observation.
 * @param focused - require the editor focused at observation time.
 * @returns the exact node; the caller disposes it after input settles.
 */
export async function requireBrowserElement(
  locator: Locator, observed: BrowserObservedElements | undefined, focused = false,
): Promise<BrowserPinnedElement> {
  const failure = () => new ComputerError('ELEMENT_NOT_OBSERVED', 'The locator does not select an element from the latest observation.', 'none',
    'Observe the same tab and use a returned locator. Address the intended editor explicitly when focus changes.')
  if (observed === undefined || await locator.count() !== 1) throw failure()
  const element = await locator.elementHandle()
  if (element === null) throw failure()
  try {
    if (!await element.evaluate((node, snapshot) => {
      if (snapshot.focused && snapshot.observed.focused !== node) return false
      for (let index = 0; index < snapshot.observed.elements.length; index++) {
        if (snapshot.observed.elements[index] === node) return true
      }
      return false
    }, { observed, focused })) throw failure()
    return element
  } catch (error) {
    await element.dispose()
    throw error
  }
}
