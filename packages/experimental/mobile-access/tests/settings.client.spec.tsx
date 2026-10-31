// @vitest-environment jsdom
/** Plugin-owned phone pairing, account-free navigation, and revoked-link feedback. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type {} from '../src/client/mount.ts'
import { NeurixMenu, type NeurixMenuProps } from '../src/client/NeurixMenu.tsx'
import { MobileAccessRow, type MobileAccessRowProps } from '../src/client/MobileAccessRow.tsx'
import { ConnectionToast, type ConnectionToastProps } from '../src/client/ConnectionToast.tsx'
import { ConnectionNotice } from '../src/client/notice.ts'
import { en } from '../src/client/locales.ts'
import type { MobileAccessState } from '../src/types.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const state: MobileAccessState = { mode: 'internet', networks: [], phone: false, connection: {
  url: 'https://agent.example.test/neurix/pair#connect=synthetic-fixture-secret', qrCode: 'data:image/png;base64,fixture', encrypted: true,
} }
function panel(value: MobileAccessState | undefined = state) {
  const actions = { open: vi.fn(async () => state), close: vi.fn(async () => ({ ...state, connection: undefined })),
    regenerate: vi.fn(async () => state), onOutcome: vi.fn(), disconnectPhone: vi.fn(async () => {}) }
  const props = { ...actions, view: 'page', t: makeTranslate(en, commonEn),
    useResource: () => ({ status: value === undefined ? 'loading' : 'live', value, failure: undefined }),
  } as MobileAccessRowProps
  return { actions, props }
}

it.each([true, false])('keeps settings and feedback in the settings launcher with wide=%s', (wide) => {
  const openSettings = vi.fn()
  const external = vi.spyOn(window, 'open').mockReturnValue(null)
  const props = { wide, openSettings, t: makeTranslate(en, commonEn) } as NeurixMenuProps
  render(<NeurixMenu {...props} />)
  const trigger = screen.getByRole('button', { name: en.settings })
  fireEvent.focus(trigger)
  if (!wide) expect(screen.getByRole('tooltip').textContent).toBe(en.settings)
  fireEvent.click(trigger)
  expect(screen.getAllByRole('menuitem')).toHaveLength(2)
  fireEvent.click(screen.getByRole('menuitem', { name: en.feedback }))
  expect(screen.getByText(en.feedbackUnavailable)).toBeTruthy()
  expect(external).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('dialog').querySelector('button')!)
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('menuitem', { name: en.settings }))
  expect(openSettings).toHaveBeenCalledOnce()
})

it('shows a QR code, saved link, update action, and connection switch in the plugin page', async () => {
  const { props, actions } = panel()
  render(<MobileAccessRow {...props} />)
  expect(screen.getByRole('img', { name: en.qr }).getAttribute('src')).toBe(state.connection!.qrCode)
  expect(screen.getByRole('textbox', { name: en.link })).toHaveProperty('value', state.connection!.url)
  fireEvent.click(screen.getByRole('button', { name: en.regenerate }))
  await vi.waitFor(() => { expect(actions.onOutcome).toHaveBeenCalledWith('updated') })
  fireEvent.click(screen.getByRole('button', { name: en.stop }))
  await vi.waitFor(() => { expect(actions.onOutcome).toHaveBeenCalledWith('closed') })
  expect(screen.queryByLabelText('Password')).toBeNull()
})

it('retains the displayed link and reports a failed update', async () => {
  const { props, actions } = panel()
  actions.regenerate.mockRejectedValueOnce(new Error('fixture persistence failure'))
  render(<MobileAccessRow {...props} />)
  fireEvent.click(screen.getByRole('button', { name: en.regenerate }))
  await vi.waitFor(() => { expect(actions.onOutcome).toHaveBeenCalledWith('failed') })
  expect(screen.getByRole('textbox', { name: en.link })).toHaveProperty('value', state.connection!.url)
})

it('enables internet access without account setup', async () => {
  const { props, actions } = panel({ mode: 'internet', networks: [], phone: false })
  render(<MobileAccessRow {...props} />)
  fireEvent.click(screen.getByRole('button', { name: en.start }))
  await vi.waitFor(() => { expect(actions.open).toHaveBeenCalledWith('127.0.0.1') })
  expect(actions.onOutcome).toHaveBeenCalledWith('opened')
})

it('keeps an accepted operation observable after its page unmounts', async () => {
  const { props, actions } = panel()
  const pending = Promise.withResolvers<MobileAccessState>()
  actions.regenerate.mockReturnValueOnce(pending.promise)
  const view = render(<MobileAccessRow {...props} />)
  fireEvent.click(screen.getByRole('button', { name: en.regenerate }))
  view.unmount()
  await act(async () => { pending.resolve(state) })
  expect(actions.onOutcome).toHaveBeenCalledWith('updated')
})

it('does not expose the computer link on a phone', () => {
  const { props, actions } = panel({ mode: 'internet', networks: [], phone: true })
  render(<MobileAccessRow {...props} />)
  expect(screen.queryByRole('textbox')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.disconnectPhone }))
  expect(actions.disconnectPhone).toHaveBeenCalledOnce()
})

it('renders a loading state and the plugin summary', () => {
  const { props } = panel(undefined)
  const view = render(<MobileAccessRow {...props} />)
  expect(screen.getByRole('region')).toBeTruthy()
  view.rerender(<MobileAccessRow {...props} view="summary" />)
  expect(screen.getByText(en.description)).toBeTruthy()
})

it('confirms copying only after a successful clipboard write', async () => {
  const prior = Object.getOwnPropertyDescriptor(document, 'execCommand')
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => true) })
  try {
    render(<MobileAccessRow {...panel().props} />)
    fireEvent.click(screen.getByRole('button', { name: en.copy }))
    await vi.waitFor(() => { expect(screen.getByRole('button', { name: en.copied })).toBeTruthy() })
  } finally {
    if (prior === undefined) Reflect.deleteProperty(document, 'execCommand')
    else Object.defineProperty(document, 'execCommand', prior)
  }
})

it('keeps action feedback in a shell-owned source until dismissed', () => {
  const notice = new ConnectionNotice()
  const props = { useConnectionNotice: () => notice.source.getSnapshot(), dismiss: () => { notice.dismiss() },
    t: makeTranslate(en, commonEn) } as ConnectionToastProps
  const view = render(<ConnectionToast {...props} />)
  expect(screen.queryByText(en.updated)).toBeNull()
  notice.report('updated')
  view.rerender(<ConnectionToast {...props} />)
  expect(screen.getByText(en.updated)).toBeTruthy()
  notice.dismiss()
  view.rerender(<ConnectionToast {...props} />)
  expect(screen.queryByText(en.updated)).toBeNull()
})
