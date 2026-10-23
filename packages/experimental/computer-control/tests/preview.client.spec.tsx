// @vitest-environment jsdom
/** Preview refresh, Session isolation, and display controls. */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { ComputerPreview, type ComputerPreviewProps } from '../src/client/ComputerPreview.tsx'
import { en } from '../src/client/locales.ts'
import type { ComputerPreviewSnapshot } from '../src/preview-types.ts'

/** Fake time waits for React's image and feedback commit before assertions. */
async function advance(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

const decode = vi.fn<() => Promise<void>>()
beforeEach(() => {
  decode.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('Image', class { src = ''; decode = decode })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
const frame: ComputerPreviewSnapshot = { refreshMs: 750, frame: { kind: 'frame', imageUrl: 'data:image/png;base64,AA==',
  title: 'Owned window', action: 'type', active: true, capturedAt: 1, cursor: { x: 0.4, y: 0.3 } } }
const props = (loadPreview: ComputerPreviewProps['loadPreview']): ComputerPreviewProps => ({ sessionId: SessionId('one'),
  loadPreview, t: makeTranslate(en, commonEn) }) as ComputerPreviewProps

it.each(['a', 'A', 'ß', 'é', '👩🏽‍💻', '中'])('shows the exact current character %s beside the keyboard icon', async (character) => {
  const typing = structuredClone(frame)
  if (typing.frame.kind !== 'frame') throw new Error('Expected an image frame')
  typing.frame.keyboard = { kind: 'typing', key: character }
  const view = render(<ComputerPreview {...props(async () => typing)} />)
  await vi.waitFor(() => { expect(view.container.ownerDocument.querySelector('kbd')?.textContent).toBe(character) })
  const keycap = view.container.ownerDocument.querySelector('kbd')
  expect(keycap?.parentElement?.querySelector('svg')).toBeTruthy()
})

it('shows only the keyboard icon while no delivered key is available', async () => {
  const typing = structuredClone(frame)
  if (typing.frame.kind !== 'frame') throw new Error('Expected an image frame')
  typing.frame.keyboard = { kind: 'typing' }
  const view = render(<ComputerPreview {...props(async () => typing)} />)
  await vi.waitFor(() => { expect(view.container.ownerDocument.querySelector('svg rect[rx="3"]')).toBeTruthy() })
  expect(view.container.ownerDocument.querySelector('kbd')).toBeNull()
  expect(view.container.ownerDocument.body.textContent).not.toContain('•••')
})

it('shows actual captures, stops refresh on close, and can reopen the panel', async () => {
  const load = vi.fn(async () => frame)
  render(<ComputerPreview {...props(load)} />)
  await vi.waitFor(() => { expect(screen.getByRole('img', { name: en.previewImage })).toBeTruthy() })
  expect(screen.getByText(en.previewType)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.previewClose }))
  expect(screen.queryByRole('img')).toBeNull()
  const calls = load.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: en.previewShow }))
  await vi.waitFor(() => { expect(load.mock.calls.length).toBeGreaterThan(calls) })
})

it('keeps automatic preview enabled when Show is clicked before a target exists', async () => {
  const load = vi.fn(async () => frame).mockResolvedValueOnce({ refreshMs: 2000, frame: { kind: 'idle' } })
  render(<ComputerPreview {...props(load)} />)
  await vi.waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })
  const show = screen.getByRole('button', { name: en.previewShow })
  expect(show.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(show)
  await vi.waitFor(() => { expect(screen.getByRole('img')).toBeTruthy() })
  expect(screen.getByRole('button', { name: en.previewHide }).getAttribute('aria-pressed')).toBe('true')
})

it('commits a decoded image and its drag cursor together instead of putting a new cursor over an old image', async () => {
  vi.useFakeTimers()
  const decoded = Promise.withResolvers<undefined>()
  decode.mockResolvedValueOnce(undefined).mockImplementationOnce(() => decoded.promise)
  const next = structuredClone(frame)
  if (next.frame.kind !== 'frame') throw new Error('Expected an image frame')
  next.frame.imageUrl = 'data:image/png;base64,BB=='
  next.frame.cursor = { x: .8, y: .9, pressed: true }
  const load = vi.fn(async () => frame).mockResolvedValueOnce(frame).mockResolvedValue(next)
  render(<ComputerPreview {...props(load)} />)
  await advance(0)
  expect(screen.getByRole('img').getAttribute('src')).toBe(frame.frame.kind === 'frame' ? frame.frame.imageUrl : '')
  await advance(750)
  expect(document.querySelector('svg[data-pressed]')).toBeNull()
  expect(screen.getByRole('img').getAttribute('src')).not.toBe(next.frame.imageUrl)
  decoded.resolve(undefined)
  await advance(0)
  expect(screen.getByRole('img').getAttribute('src')).toBe(next.frame.imageUrl)
  const cursor = document.querySelector('svg[data-pressed]')
  expect(cursor?.getAttribute('style')).toContain('left: 80%')
  expect(cursor?.getAttribute('style')).toContain('top: 90%')
})

it('does not show a stale image when switching Sessions during capture', async () => {
  const pending = Promise.withResolvers<ComputerPreviewSnapshot>()
  const load = vi.fn(async (id: string) => id === 'one' ? frame : pending.promise)
  const view = render(<ComputerPreview {...props(load)} />)
  await vi.waitFor(() => { expect(screen.getByRole('img')).toBeTruthy() })
  view.rerender(<ComputerPreview {...props(load)} sessionId={SessionId('two')} />)
  expect(screen.queryByRole('img')).toBeNull()
  pending.resolve({ refreshMs: 750, frame: { kind: 'idle' } })
  await vi.waitFor(() => { expect(screen.queryByRole('img')).toBeNull() })
})

it('retains the last image with a visible failure and supports collapse and size changes', async () => {
  vi.useFakeTimers()
  const load = vi.fn(async () => frame)
  render(<ComputerPreview {...props(load)} />)
  await advance(0)
  fireEvent.click(screen.getByRole('button', { name: en.previewEnlarge }))
  expect(screen.getByRole('button', { name: en.previewRestore })).toBeTruthy()
  load.mockResolvedValue({ refreshMs: 750, frame: { kind: 'unavailable', title: 'Owned window', code: 'CAPTURE_FAILED' } })
  await advance(750)
  expect(screen.getByRole('img')).toBeTruthy()
  expect(screen.getAllByText(en.previewUnavailable).length).toBeGreaterThan(0)
  load.mockResolvedValue(frame)
  fireEvent.click(screen.getByRole('button', { name: en.previewRetry }))
  expect(screen.getByRole('img')).toBeTruthy()
  await advance(0)
  expect(screen.queryByText(en.previewUnavailable)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.previewCollapse }))
  expect(screen.queryByRole('img')).toBeNull()
  const before = load.mock.calls.length
  await advance(5000)
  expect(load.mock.calls.length).toBe(before)
})


it('names the scrolling direction in the picture-in-picture activity indicator', async () => {
  const scrolling = structuredClone(frame)
  if (scrolling.frame.kind !== 'frame') throw new Error('Expected an image frame')
  scrolling.frame.action = 'scroll-down'
  render(<ComputerPreview {...props(async () => scrolling)} />)
  await vi.waitFor(() => { expect(screen.getByRole('status').textContent).toContain(en.previewScrollDown) })
})

it('retains the image and explains the permission needed for a failed capture', async () => {
  vi.useFakeTimers()
  const load = vi.fn(async () => frame)
  render(<ComputerPreview {...props(load)} />)
  await advance(0)
  load.mockResolvedValue({ refreshMs: 750, frame: { kind: 'unavailable', title: 'Owned window', code: 'PERMISSION_REQUIRED' } })
  await advance(750)
  expect(screen.getByRole('img')).toBeTruthy()
  expect(screen.getByText(en.previewPermissionRequired)).toBeTruthy()
})
