// @vitest-environment jsdom
/** Exact visible editor values preserve whitespace within an aggregate text budget. */

import type { Page } from 'playwright'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { observeBrowserFields } from '../src/browser-fields.ts'

const page = { evaluate: (async (expression: string) => {
  const result: unknown = window.eval(expression)
  return result
}) as Page['evaluate'] }

beforeEach(() => {
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 200, 60))
})
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('preserves actual line breaks, leading spaces and emoji rather than the accessibility summary whitespace', async () => {
  document.body.innerHTML = '<textarea id="notes" aria-label="Notes"></textarea>'
  const notes = document.querySelector('textarea')!
  notes.value = ' 第一行：中文\nLine 2: English🙂 '
  notes.focus()
  expect(await observeBrowserFields(page, 5, 100)).toEqual([
    { tag: 'textarea', placeholder: '', label: 'Notes', focused: true, locator: { by: 'css', selector: '#notes' },
      value: notes.value, valueTruncated: false },
  ])
})

it('shares the exact-value character budget across fields and marks every truncated value', async () => {
  document.body.innerHTML = '<input id="first" value="abc"><input id="second" value="defg"><input id="third" value="h">'
  const values = await observeBrowserFields(page, 5, 5)
  expect(values.map(field => [field.value, field.valueTruncated])).toEqual([['abc', false], ['de', true], ['', true]])
  expect(await observeBrowserFields(page, 1, 5)).toHaveLength(1)
  expect((await observeBrowserFields(page, 5, 0)).every(field => field.value === '' && field.valueTruncated)).toBe(true)
})

it('excludes passwords, readonly controls and editors hidden from the visible page', async () => {
  document.body.innerHTML = '<input type="PASSWORD" value="secret"><input readonly value="readonly">'
    + '<input style="visibility:hidden" value="hidden"><div aria-hidden="true"><input value="overlay"></div>'
    + '<input id="offscreen" value="outside"><input id="visible" value="safe">'
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return new DOMRect(this.id === 'offscreen' ? innerWidth + 1 : 20, 30, 200, 60)
  })
  expect((await observeBrowserFields(page, 10, 100)).map(field => field.value)).toEqual(['safe'])
})
