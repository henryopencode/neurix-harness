// @vitest-environment jsdom
/** Page feedback executes in the owned document and stays outside accessibility text. */

import type { Page } from 'playwright'
import { afterEach, expect, it, vi } from 'vitest'
import { showBrowserFeedback } from '../src/browser-overlay.ts'

afterEach(() => {
  document.querySelector('[data-neurix-computer-feedback]')?.remove()
  Reflect.deleteProperty(window, Symbol.for('neurix.computer.feedback'))
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('renders the independent pointer and key indicator, then hides them after the configured lifetime', async () => {
  vi.useFakeTimers()
  const evaluate = vi.fn(async (expression: string) => {
    if (typeof expression !== 'string') throw new Error('This fixture accepts page expressions only')
    // jsdom executes the expression as Playwright executes a string, without implicitly invoking a returned function.
    const result: unknown = window.eval(expression)
    return result
  }) as Page['evaluate']
  const page = { evaluate }
  await showBrowserFeedback(page, { x: 120, y: 180, keys: ['⌘', 'A'], durationMs: 0, idleMs: 1600 })
  const host = document.querySelector('div[aria-hidden="true"]')
  expect(host).not.toBeNull()
  expect(host?.getAttribute('aria-hidden')).toBe('true')
  expect(host?.shadowRoot).toBeNull()
  expect(host?.textContent).toBe('')
  const state = Reflect.get(window, Symbol.for('neurix.computer.feedback')) as {
    host: HTMLElement
    cursor: SVGElement
    keys: HTMLElement
  }
  expect(state.cursor.style.transform).toBe('translate(120px,180px)')
  expect([...state.keys.querySelectorAll('kbd')].map(cap => cap.textContent)).toEqual(['⌘', 'A'])
  expect(state.keys.style.opacity).toBe('1')
  expect(state.host.style.visibility).toBe('visible')
  await vi.advanceTimersByTimeAsync(1599)
  expect(state.host.style.visibility).toBe('visible')
  await vi.advanceTimersByTimeAsync(1)
  expect(state.host.style.visibility).toBe('hidden')
  state.host.remove()
})


it('shows the delivered grapheme as text and uses only the keyboard icon before one is available', async () => {
  vi.useFakeTimers()
  const evaluate = vi.fn(async (expression: string) => {
    const result: unknown = window.eval(expression)
    return result
  }) as Page['evaluate']
  const page = { evaluate }
  await showBrowserFeedback(page, { typing: true, idleMs: 2000 })
  const state = Reflect.get(window, Symbol.for('neurix.computer.feedback')) as { keys: HTMLElement }
  expect(state.keys.dataset.mode).toBe('typing')
  expect(state.keys.querySelectorAll('.keyboard i')).toHaveLength(13)
  expect(state.keys.textContent).toBe('')
  expect(state.keys.querySelector('kbd')).toBeNull()
  await showBrowserFeedback(page, { typing: true, key: '👩‍💻', hold: true, idleMs: 2000 })
  expect(state.keys.querySelector('kbd')?.textContent).toBe('👩‍💻')
  await showBrowserFeedback(page, { typing: true, key: '<script>', hold: false, idleMs: 2000 })
  expect(state.keys.querySelector('kbd')?.textContent).toBe('<script>')
  expect(state.keys.querySelector('script')).toBeNull()
  expect(state.keys.querySelector('.dots')).toBeNull()
  await showBrowserFeedback(page, { keys: ['⌘', 'A'], idleMs: 2000 })
  expect(state.keys.querySelector('.keyboard')).toBeNull()
  expect(state.keys.querySelectorAll('kbd')).toHaveLength(2)
  await showBrowserFeedback(page, { x: 40, y: 50, idleMs: 2000 })
  expect(state.keys.style.opacity).toBe('0')
})


it('keeps a pressed pointer visible through a drag and restores its release timer after mouse-up', async () => {
  vi.useFakeTimers()
  const evaluate = vi.fn(async (expression: string) => {
    const result: unknown = window.eval(expression)
    return result
  }) as Page['evaluate']
  const page = { evaluate }
  await showBrowserFeedback(page, { x: 20, y: 30, pressed: true, idleMs: 100 })
  const state = Reflect.get(window, Symbol.for('neurix.computer.feedback')) as {
    host: HTMLElement
    cursor: HTMLElement
    ring: HTMLElement
  }
  expect(state.cursor.dataset.pressed).toBe('true')
  await vi.advanceTimersByTimeAsync(5000)
  expect(state.host.style.visibility).toBe('visible')
  await showBrowserFeedback(page, { x: 140, y: 80, idleMs: 100 })
  expect(state.cursor.dataset.pressed).toBe('true')
  expect(state.cursor.style.transform).toBe('translate(140px,80px)')
  await showBrowserFeedback(page, { pressed: false, click: true, idleMs: 100 })
  expect(state.cursor.dataset.pressed).toBe('false')
  expect(state.cursor.classList.contains('clicked')).toBe(true)
  expect(state.ring.classList.contains('pulse')).toBe(true)
  await vi.advanceTimersByTimeAsync(100)
  expect(state.host.style.visibility).toBe('hidden')
})


it.each([['up', '↑'], ['down', '↓'], ['left', '←'], ['right', '→']] as const)(
  'shows a %s wheel cue near the independent pointer and fades it after scrolling stops', async (direction, arrow) => {
    vi.useFakeTimers()
    const evaluate = vi.fn(async (expression: string) => {
      const result: unknown = window.eval(expression)
      return result
    }) as Page['evaluate']
    const page = { evaluate }
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(76)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(46)
    await showBrowserFeedback(page, { x: 120, y: 180, scroll: direction, idleMs: 1000 })
    const state = Reflect.get(window, Symbol.for('neurix.computer.feedback')) as {
      host: HTMLElement
      cursor: HTMLElement
      scroll: HTMLElement
      keys: HTMLElement
    }
    expect(state.scroll.dataset.direction).toBe(direction)
    expect(state.scroll.querySelector('.scroll-arrow')?.textContent).toBe(arrow)
    expect(state.scroll.classList.contains('visible')).toBe(true)
    expect(state.scroll.style.left).toBe('160px')
    expect(state.scroll.style.top).toBe('173px')
    expect(state.keys.style.opacity).toBe('0')
    expect(state.cursor.classList.contains('clicked')).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(state.scroll.classList.contains('visible')).toBe(false)
    expect(state.host.style.visibility).toBe('visible')
    await showBrowserFeedback(page, { x: 120, y: 180, scroll: direction, idleMs: 1000 })
    await vi.advanceTimersByTimeAsync(160)
    expect(state.host.style.visibility).toBe('visible')
    expect(state.scroll.classList.contains('visible')).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(state.host.style.visibility).toBe('hidden')
  },
)


it('keeps a wheel cue visible during its gesture and places it on the left near the viewport edge', async () => {
  vi.useFakeTimers()
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(76)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(46)
  const evaluate = vi.fn(async (expression: string) => {
    const result: unknown = window.eval(expression)
    return result
  }) as Page['evaluate']
  const page = { evaluate }
  await showBrowserFeedback(page, { x: innerWidth - 30, y: 100, scroll: 'down', hold: true, idleMs: 100 })
  const state = Reflect.get(window, Symbol.for('neurix.computer.feedback')) as { scroll: HTMLElement; host: HTMLElement }
  expect(Number.parseFloat(state.scroll.style.left) + 76).toBeLessThan(innerWidth - 30)
  expect(state.scroll.dataset.running).toBe('true')
  await vi.advanceTimersByTimeAsync(5000)
  expect(state.host.style.visibility).toBe('visible')
  await showBrowserFeedback(page, { scroll: 'down', hold: false, idleMs: 100 })
  expect(state.scroll.dataset.running).toBe('false')
  await vi.advanceTimersByTimeAsync(260)
  expect(state.host.style.visibility).toBe('hidden')
})
