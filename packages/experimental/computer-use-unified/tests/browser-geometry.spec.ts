// @vitest-environment jsdom
/** Visible rectangles remain CSS pixels and exclude hidden page content. */

import type { Page } from 'playwright'
import { afterEach, expect, it, vi } from 'vitest'
import { observeBrowserGeometry } from '../src/browser-geometry.ts'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('returns rendered targets with viewport membership while excluding hidden elements', async () => {
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  document.body.innerHTML = '<button id="offscreen">屏幕外</button><button id="offscreen2">另一个屏外控件</button>'
    + '<button id="source">滑块</button><div id="slot" aria-label="目标槽"></div>'
    + '<div id="cards"><button>创建</button></div>'
    + '<button id="hidden" style="visibility:hidden">隐藏</button>'
    + '<div aria-hidden="true"><button id="overlay">软件提示</button></div>'
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.id === 'source') return new DOMRect(20, 30, 40, 50)
    if (this.id.startsWith('offscreen')) return new DOMRect(2000, 30, 40, 50)
    return new DOMRect(400, 30, 40, 50)
  })
  const evaluate = vi.fn(async (expression: string) => {
    const result: unknown = window.eval(expression)
    return result
  }) as Page['evaluate']
  const result = await observeBrowserGeometry({ evaluate }, 20)
  expect(result.viewport).toMatchObject({ width: innerWidth, height: innerHeight })
  expect(result.elements).toEqual([
    { tag: 'button', label: '滑块', inViewport: true, locator: { by: 'css', selector: '#source' }, bounds: { x: 20, y: 30, width: 40, height: 50 } },
    { tag: 'div', label: '目标槽', inViewport: true, locator: { by: 'css', selector: '#slot' }, bounds: { x: 400, y: 30, width: 40, height: 50 } },
    { tag: 'div', label: 'div', inViewport: true, locator: { by: 'css', selector: '#cards' }, bounds: { x: 400, y: 30, width: 40, height: 50 } },
    { tag: 'button', label: '创建', inViewport: true, locator: { by: 'css', selector: '#cards > button:nth-of-type(1)' },
      bounds: { x: 400, y: 30, width: 40, height: 50 } },
    { tag: 'button', label: '屏幕外', inViewport: false, locator: { by: 'css', selector: '#offscreen' },
      bounds: { x: 2000, y: 30, width: 40, height: 50 } },
    { tag: 'button', label: '另一个屏外控件', inViewport: false, locator: { by: 'css', selector: '#offscreen2' },
      bounds: { x: 2000, y: 30, width: 40, height: 50 } },
  ])
  expect((await observeBrowserGeometry({ evaluate }, 1)).elements).toHaveLength(1)
  expect((await observeBrowserGeometry({ evaluate }, 1)).elements[0]?.locator.selector).toBe('#source')
})
