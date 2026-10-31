// @vitest-environment jsdom
/** Preview refresh, Session isolation, and display controls. */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { ComputerPreview, type ComputerPreviewProps } from '../src/client/ComputerPreview.tsx'
import { en } from '../src/client/locales.ts'
import type { ComputerPreviewSnapshot } from '../src/types.ts'

/** Fake time waits for React's image and feedback commit before assertions. */
async function advance(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

const decode = vi.fn<() => Promise<void>>()
beforeEach(() => {
  decode.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('Image', class { src = ''; naturalWidth = 640; naturalHeight = 400; decode = decode })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const frame: ComputerPreviewSnapshot = { refreshMs: 750, frame: { kind: 'frame', imageUrl: 'data:image/png;base64,AA==',
  title: 'Owned window', action: 'type', active: true, capturedAt: 1, cursor: { x: 0.4, y: 0.3 } } }
const props = (loadPreview: ComputerPreviewProps['loadPreview']): ComputerPreviewProps => ({ sessionId: SessionId('one'),
  surface: 'applications', loadPreview, t: makeTranslate(en, commonEn) }) as ComputerPreviewProps

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

it('shows captures automatically without header controls, pauses when collapsed, and resumes when expanded', async () => {
  vi.useFakeTimers()
  const load = vi.fn(async () => frame)
  const view = render(<ComputerPreview {...props(load)} />)
  await advance(0)
  expect(screen.getByRole('img', { name: en.previewImage })).toBeTruthy()
  expect(view.container.childElementCount).toBe(0)
  expect(screen.queryByRole('button', { name: 'Close preview' })).toBeNull()
  expect(screen.getByText(en.previewType)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.previewCollapse }))
  expect(screen.queryByRole('img')).toBeNull()
  const calls = load.mock.calls.length
  await advance(5000)
  expect(load.mock.calls.length).toBe(calls)
  fireEvent.click(screen.getByRole('button', { name: en.previewExpand }))
  await advance(0)
  expect(load.mock.calls.length).toBeGreaterThan(calls)
  expect(screen.getByRole('img')).toBeTruthy()
})

it('waits for a target without adding a header button', async () => {
  vi.useFakeTimers()
  const load = vi.fn(async () => frame).mockResolvedValueOnce({ refreshMs: 2000, frame: { kind: 'idle' } })
  const view = render(<ComputerPreview {...props(load)} />)
  await advance(0)
  expect(screen.queryByRole('complementary')).toBeNull()
  expect(view.container.childElementCount).toBe(0)
  await advance(2000)
  expect(screen.getByRole('img')).toBeTruthy()
})

it('switches the maximize icon and restores the previous floating position with Escape', async () => {
  render(<ComputerPreview {...props(async () => frame)} />)
  await vi.waitFor(() => { expect(screen.getByRole('img')).toBeTruthy() })
  const panel = screen.getByRole('complementary')
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 180, 640, 400))
  fireEvent.keyDown(screen.getByRole('button', { name: en.previewDrag }), { key: 'ArrowLeft' })
  expect(panel.style.left).toBe('176px')
  const maximize = screen.getByRole('button', { name: en.previewEnlarge })
  const icon = maximize.querySelector('svg')?.getAttribute('data-icon')
  maximize.focus()
  fireEvent.click(maximize)
  expect(panel.hasAttribute('data-maximized')).toBe(true)
  const restore = screen.getByRole('button', { name: en.previewRestore })
  expect(restore).toBe(maximize)
  expect(restore.querySelector('svg')?.getAttribute('data-icon')).not.toBe(icon)
  expect(panel.style.left).toBe('')
  vi.stubGlobal('innerWidth', 390)
  fireEvent.resize(window)
  vi.stubGlobal('innerWidth', 1024)
  fireEvent.resize(window)
  fireEvent.keyDown(restore, { key: 'Escape' })
  expect(panel.hasAttribute('data-maximized')).toBe(false)
  expect(panel.style.left).toBe('176px')
  expect(panel.style.getPropertyValue('--preview-width')).toBe('640px')
  expect(document.activeElement).toBe(maximize)
})

it('retains maximization when collapsing and expanding', async () => {
  render(<ComputerPreview {...props(async () => frame)} />)
  await vi.waitFor(() => { expect(screen.getByRole('img')).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: en.previewEnlarge }))
  fireEvent.click(screen.getByRole('button', { name: en.previewCollapse }))
  expect(screen.getByRole('complementary').hasAttribute('data-maximized')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: en.previewExpand }))
  expect(screen.getByRole('complementary').hasAttribute('data-maximized')).toBe(true)
  expect(screen.getByRole('button', { name: en.previewRestore })).toBeTruthy()
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
