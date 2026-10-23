// @vitest-environment jsdom
/** Observed DOM identity and editor focus survive semantic addressing. */

import type { Locator, Page } from 'playwright'
import { afterEach, expect, it, vi } from 'vitest'
import { captureBrowserElements, requireBrowserElement, type BrowserObservedElements } from '../src/browser-observation.ts'

interface Snapshot { elements: readonly unknown[]; focused: unknown }
const disposed = vi.fn(() => Promise.resolve())
const evaluateHandle = vi.fn<Page['evaluateHandle']>()
const page = { evaluateHandle }

function observe(selectors: readonly string[]): Promise<BrowserObservedElements> {
  const value: Snapshot = {
    elements: selectors.flatMap(selector => Array.from(document.querySelectorAll(selector))),
    focused: document.activeElement,
  }
  const handle: BrowserObservedElements = {
    evaluate: vi.fn<BrowserObservedElements['evaluate']>(),
    evaluateHandle: vi.fn<BrowserObservedElements['evaluateHandle']>(),
    getProperty: vi.fn<BrowserObservedElements['getProperty']>(),
    getProperties: vi.fn<BrowserObservedElements['getProperties']>(),
    jsonValue: () => Promise.resolve(value),
    asElement: () => null,
    dispose: disposed,
    [Symbol.asyncDispose]: disposed,
  }
  evaluateHandle.mockResolvedValue(Object.assign(handle, value))
  return captureBrowserElements(page, selectors)
}

function locator(select: () => Element | null, count = 1): Locator {
  return {
    count: () => Promise.resolve(count),
    elementHandle: () => {
      const element = select()
      return Promise.resolve(element === null ? null : {
        evaluate: (work: (node: Element, input: { observed: Snapshot; focused: boolean }) => boolean,
          input: { observed: Snapshot; focused: boolean }) => Promise.resolve(work(element, input)),
        dispose: disposed,
      })
    },
  } as Locator
}

afterEach(() => { document.body.replaceChildren(); vi.clearAllMocks() })

it('returns an exact observed node and refuses a replacement with the same selector', async () => {
  document.body.innerHTML = '<input id="editor"><button id="save">Save</button>'
  const observed = await observe(['#editor', '#save'])
  const save = locator(() => document.querySelector('#save'))
  const pinned = await requireBrowserElement(save, observed)
  await pinned.dispose()
  document.querySelector('#save')!.replaceWith(document.querySelector('#save')!.cloneNode(true))
  await expect(requireBrowserElement(save, observed)).rejects.toMatchObject({ code: 'ELEMENT_NOT_OBSERVED', effect: 'none' })
  expect(document.querySelector('#save')?.textContent).toBe('Save')
  await observed.dispose()
})

it('allows explicit editor selection but refuses implicit typing after focus changes', async () => {
  document.body.innerHTML = '<input id="first"><input id="second"><button id="other">Other</button>'
  document.querySelector<HTMLInputElement>('#first')!.focus()
  const observed = await observe(['#first', '#second'])
  const focused = locator(() => document.activeElement)
  await (await requireBrowserElement(focused, observed, true)).dispose()
  document.querySelector<HTMLInputElement>('#second')!.focus()
  await expect(requireBrowserElement(focused, observed, true)).rejects.toMatchObject({ code: 'ELEMENT_NOT_OBSERVED' })
  await (await requireBrowserElement(locator(() => document.querySelector('#second')), observed)).dispose()
  await expect(requireBrowserElement(locator(() => document.querySelector('#other')), observed)).rejects.toMatchObject({ code: 'ELEMENT_NOT_OBSERVED' })
  await observed.dispose()
})

it('requires an observation and exactly one surviving node', async () => {
  document.body.innerHTML = '<button>Save</button><button>Save</button>'
  const observed = await observe([])
  await expect(requireBrowserElement(locator(() => document.querySelector('button')), undefined)).rejects.toMatchObject({ code: 'ELEMENT_NOT_OBSERVED' })
  for (const count of [0, 2]) {
    await expect(requireBrowserElement(locator(() => document.querySelector('button'), count), observed)).rejects.toMatchObject({ code: 'ELEMENT_NOT_OBSERVED' })
  }
  await expect(requireBrowserElement(locator(() => null), observed)).rejects.toMatchObject({ code: 'ELEMENT_NOT_OBSERVED' })
  await observed.dispose()
})
