// @vitest-environment jsdom
/** Localized Neurix login, explicit phone admission, and feedback without an external link. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type {} from '../src/client/mount.ts'
import { NeurixMenu, type NeurixMenuProps } from '../src/client/NeurixMenu.tsx'
import { MobileAccessRow, type MobileAccessRowProps } from '../src/client/MobileAccessRow.tsx'
import { en } from '../src/client/locales.ts'
import type { MobileAccessState, NeurixAccountState } from '../src/types.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('creates a Neurix account from the launcher and keeps feedback on the current page', async () => {
  const openWindow = vi.spyOn(window, 'open').mockReturnValue(null)
  const initial: NeurixAccountState = { configured: false, signedIn: false }
  const registered: NeurixAccountState = { configured: true, signedIn: true, username: 'test.owner' }
  const register = vi.fn(async () => registered)
  const props = { wide: true, openSettings: vi.fn(), loadAccount: async () => initial, register,
    signIn: vi.fn(async () => registered), signOut: vi.fn(async () => initial), t: makeTranslate(en, commonEn) } as NeurixMenuProps
  render(<NeurixMenu {...props} />)
  await vi.waitFor(() =>{  expect(screen.getByRole('button', { name: en.more })).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: en.more }))
  fireEvent.click(screen.getByRole('menuitem', { name: en.signIn }))
  fireEvent.change(screen.getByLabelText(en.username), { target: { value: 'test.owner' } })
  fireEvent.change(screen.getByLabelText(en.password), { target: { value: 'synthetic-test-password' } })
  fireEvent.submit(screen.getByLabelText(en.password).closest('form')!)
  await vi.waitFor(() =>{  expect(register).toHaveBeenCalledExactlyOnceWith('test.owner', 'synthetic-test-password') })
  await vi.waitFor(() =>{  expect(screen.queryByRole('dialog')).toBeNull() })
  fireEvent.click(screen.getByRole('button', { name: en.more }))
  fireEvent.click(screen.getByRole('menuitem', { name: en.feedback }))
  expect(screen.getByText(en.feedbackUnavailable)).toBeTruthy()
  expect(openWindow).not.toHaveBeenCalled()
})

it('requires a signed-in owner before connecting and shows the exact returned QR code and URL', async () => {
  const initial: MobileAccessState = { networks: [{ name: 'Wi-Fi', host: '192.0.2.1' }], account: {
    configured: true, signedIn: true, username: 'test.owner',
  } }
  const connected: MobileAccessState = { ...initial, connection: {
    url: 'http://192.0.2.1:3081/', qrCode: 'data:image/png;base64,fixture', encrypted: false,
  } }
  const open = vi.fn(async () => connected)
  const close = vi.fn(async () => initial)
  const props = { load: async () => initial, open, close, t: makeTranslate(en, commonEn) } as MobileAccessRowProps
  render(<MobileAccessRow {...props} />)
  await vi.waitFor(() =>{  expect(screen.getByRole('button', { name: en.start })).toHaveProperty('disabled', false) })
  fireEvent.click(screen.getByRole('button', { name: en.start }))
  await vi.waitFor(() =>{  expect(open).toHaveBeenCalledExactlyOnceWith('192.0.2.1') })
  await vi.waitFor(() =>{  expect(screen.getByLabelText(en.link)).toHaveProperty('value', connected.connection!.url) })
  expect(screen.getByRole('img', { name: en.qr }).getAttribute('src')).toBe(connected.connection!.qrCode)
  fireEvent.click(screen.getByRole('button', { name: en.stop }))
  await vi.waitFor(() =>{  expect(close).toHaveBeenCalledTimes(1) })
  await vi.waitFor(() =>{  expect(screen.queryByLabelText(en.link)).toBeNull() })
})

it('keeps network admission disabled until the owner signs in', async () => {
  const state: MobileAccessState = { networks: [{ name: 'Wi-Fi', host: '192.0.2.1' }], account: { configured: false, signedIn: false } }
  const props = { load: async () => state, open: vi.fn(), close: vi.fn(), t: makeTranslate(en, commonEn) } as MobileAccessRowProps
  render(<MobileAccessRow {...props} />)
  await vi.waitFor(() =>{  expect(screen.getByRole('button', { name: en.start })).toHaveProperty('disabled', true) })
  expect(screen.getByText(en.signInFirst)).toBeTruthy()
})

it('signs back into an existing account, reports a failure, and signs out without opening a provider page', async () => {
  const initial: NeurixAccountState = { configured: true, signedIn: false, username: 'test.owner' }
  const signedIn: NeurixAccountState = { ...initial, signedIn: true }
  const signIn = vi.fn().mockRejectedValueOnce(new Error('fixture failure')).mockResolvedValue(signedIn)
  const signOut = vi.fn(async () => initial)
  const settings = vi.fn()
  const props = { wide: false, openSettings: settings, settingsShortcut: { keys: ['⌘', ','] },
    loadAccount: async () => initial, register: vi.fn(), signIn, signOut, t: makeTranslate(en, commonEn) } as NeurixMenuProps
  render(<NeurixMenu {...props} />)
  fireEvent.click(screen.getByRole('button', { name: en.more }))
  fireEvent.click(screen.getByRole('menuitem', { name: en.settings }))
  expect(settings).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: en.more }))
  fireEvent.click(screen.getByRole('menuitem', { name: en.signIn }))
  await vi.waitFor(() =>{  expect(screen.getByLabelText(en.password)).toBeTruthy() })
  fireEvent.change(screen.getByLabelText(en.username), { target: { value: 'test.owner' } })
  fireEvent.change(screen.getByLabelText(en.password), { target: { value: 'synthetic-test-password' } })
  const form = screen.getByLabelText(en.password).closest('form')!
  fireEvent.submit(form)
  await vi.waitFor(() =>{  expect(screen.getByRole('alert')).toHaveProperty('textContent', en.accountFailed) })
  fireEvent.submit(form)
  await vi.waitFor(() =>{  expect(screen.queryByRole('dialog')).toBeNull() })
  fireEvent.click(screen.getByRole('button', { name: en.more }))
  fireEvent.click(screen.getByRole('menuitem', { name: en.accountTitle }))
  expect(screen.getByText('test.owner', { selector: 'div' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.signOut }))
  await vi.waitFor(() =>{  expect(signOut).toHaveBeenCalledTimes(1) })
})

it('recovers an unavailable account read and closes feedback without external navigation', async () => {
  const loadAccount = vi.fn().mockRejectedValueOnce(new Error('fixture offline')).mockResolvedValue({ configured: false, signedIn: false })
  const props = { wide: true, openSettings: vi.fn(), loadAccount, register: vi.fn(), signIn: vi.fn(), signOut: vi.fn(),
    t: makeTranslate(en, commonEn) } as NeurixMenuProps
  render(<NeurixMenu {...props} />)
  await vi.waitFor(() =>{  expect(loadAccount).toHaveBeenCalledTimes(1) })
  fireEvent.click(screen.getByRole('button', { name: en.more }))
  fireEvent.click(screen.getByRole('menuitem', { name: en.signIn }))
  fireEvent.click(screen.getByRole('button', { name: en.retry }))
  await vi.waitFor(() =>{  expect(screen.queryByRole('dialog')).toBeNull() })
  fireEvent.click(screen.getByRole('button', { name: en.more }))
  fireEvent.click(screen.getByRole('menuitem', { name: en.feedback }))
  fireEvent.click(screen.getAllByRole('button', { name: en.close }).at(-1)!)
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('offers Retry for an empty or failed network list and retains updated connection state on failure', async () => {
  const initial: MobileAccessState = { networks: [], account: { configured: true, signedIn: true } }
  const ready: MobileAccessState = { ...initial, networks: [{ name: 'Ethernet', host: '192.0.2.1' }, { name: 'Wi-Fi', host: '192.0.2.2' }] }
  const connected: MobileAccessState = { ...ready, connection: { url: 'https://192.0.2.2:3081/', qrCode: 'data:image/png;base64,fixture', encrypted: true } }
  const load = vi.fn().mockRejectedValueOnce(new Error('fixture offline')).mockResolvedValueOnce(initial)
    .mockResolvedValueOnce(ready).mockResolvedValue(connected)
  const open = vi.fn().mockRejectedValueOnce(new Error('unknown connection outcome'))
  const close = vi.fn(async () => ready)
  const props = { load, open, close, t: makeTranslate(en, commonEn) } as MobileAccessRowProps
  render(<MobileAccessRow {...props} />)
  await vi.waitFor(() =>{  expect(screen.getByRole('alert')).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: en.retry }))
  await vi.waitFor(() =>{  expect(screen.getByText(en.empty)).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: en.retry }))
  await vi.waitFor(() =>{  expect(screen.getByLabelText(en.network)).toBeTruthy() })
  fireEvent.change(screen.getByLabelText(en.network), { target: { value: '192.0.2.2' } })
  fireEvent.click(screen.getByRole('button', { name: en.start }))
  await vi.waitFor(() =>{  expect(screen.getByLabelText(en.link)).toBeTruthy() })
  expect(open).toHaveBeenCalledWith('192.0.2.2')
  expect(screen.getByText(en.encrypted)).toBeTruthy()
  fireEvent.focus(screen.getByLabelText(en.link))
  expect(screen.getByLabelText(en.link)).toHaveProperty('selectionStart', 0)
})

it.each([false, true])('ignores a late initial account read after unmount (failure: %s)', async (failed) => {
  const pending = Promise.withResolvers<NeurixAccountState>()
  const props = { wide: true, openSettings: vi.fn(), loadAccount: () => pending.promise,
    register: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), t: makeTranslate(en, commonEn) } as NeurixMenuProps
  const view = render(<NeurixMenu {...props} />)
  view.unmount()
  await act(async () => { if (failed) pending.reject(new Error('fixture closed')); else pending.resolve({ configured: false, signedIn: false }) })
  expect(screen.queryByRole('button')).toBeNull()
})

it.each([false, true])('ignores a late initial network read after unmount (failure: %s)', async (failed) => {
  const pending = Promise.withResolvers<MobileAccessState>()
  const props = { load: () => pending.promise, open: vi.fn(), close: vi.fn(), t: makeTranslate(en, commonEn) } as MobileAccessRowProps
  const view = render(<MobileAccessRow {...props} />)
  view.unmount()
  await act(async () => { if (failed) pending.reject(new Error('fixture closed')); else pending.resolve({ networks: [], account: { configured: false, signedIn: false } }) })
  expect(screen.queryByRole('region')).toBeNull()
})

it.each([false, true])('ignores a phone connection outcome after its row is removed (failure: %s)', async (failed) => {
  const pending = Promise.withResolvers<MobileAccessState>()
  const state: MobileAccessState = { networks: [{ name: 'Wi-Fi', host: '192.0.2.1' }], account: { configured: true, signedIn: true } }
  const props = { load: async () => state, open: () => pending.promise, close: vi.fn(),
    t: makeTranslate(en, commonEn) } as MobileAccessRowProps
  const view = render(<MobileAccessRow {...props} />)
  await vi.waitFor(() =>{  expect(screen.getByRole('button', { name: en.start })).toHaveProperty('disabled', false) })
  fireEvent.click(screen.getByRole('button', { name: en.start }))
  view.unmount()
  await act(async () => { if (failed) pending.reject(new Error('fixture closed')); else pending.resolve(state) })
  expect(screen.queryByRole('region')).toBeNull()
})

it.each([false, true])('contains an unsuccessful recovery read (removed: %s)', async (removed) => {
  const recovery = Promise.withResolvers<MobileAccessState>()
  const state: MobileAccessState = { networks: [{ name: 'Wi-Fi', host: '192.0.2.1' }], account: { configured: true, signedIn: true } }
  const load = vi.fn().mockResolvedValueOnce(state).mockReturnValueOnce(recovery.promise)
  const props = { load, open: vi.fn().mockRejectedValue(new Error('fixture connection failed')), close: vi.fn(),
    t: makeTranslate(en, commonEn) } as MobileAccessRowProps
  const view = render(<MobileAccessRow {...props} />)
  await vi.waitFor(() =>{  expect(screen.getByRole('button', { name: en.start })).toHaveProperty('disabled', false) })
  fireEvent.click(screen.getByRole('button', { name: en.start }))
  await vi.waitFor(() =>{  expect(load).toHaveBeenCalledTimes(2) })
  if (removed) view.unmount()
  await act(async () => { recovery.reject(new Error('fixture still offline')) })
  if (!removed) expect(screen.getByRole('button', { name: en.retry })).toBeTruthy()
})

it('ignores a successful recovery read after the row is removed', async () => {
  const recovery = Promise.withResolvers<MobileAccessState>()
  const state: MobileAccessState = { networks: [{ name: 'Wi-Fi', host: '192.0.2.1' }], account: { configured: true, signedIn: true } }
  const load = vi.fn().mockResolvedValueOnce(state).mockReturnValueOnce(recovery.promise)
  const props = { load, open: vi.fn().mockRejectedValue(new Error('fixture connection failed')), close: vi.fn(),
    t: makeTranslate(en, commonEn) } as MobileAccessRowProps
  const view = render(<MobileAccessRow {...props} />)
  await vi.waitFor(() =>{  expect(screen.getByRole('button', { name: en.start })).toHaveProperty('disabled', false) })
  fireEvent.click(screen.getByRole('button', { name: en.start }))
  await vi.waitFor(() =>{  expect(load).toHaveBeenCalledTimes(2) })
  view.unmount()
  await act(async () => { recovery.resolve(state) })
  expect(screen.queryByRole('region')).toBeNull()
})

it('confirms a copied connection link only after a successful clipboard write', async () => {
  const prior = Object.getOwnPropertyDescriptor(document, 'execCommand')
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => true) })
  try {
    const state: MobileAccessState = { networks: [], account: { configured: true, signedIn: true }, connection: {
      url: 'https://192.0.2.1/', qrCode: 'data:image/png;base64,fixture', encrypted: true,
    } }
    const props = { load: async () => state, open: vi.fn(), close: vi.fn(), t: makeTranslate(en, commonEn) } as MobileAccessRowProps
    render(<MobileAccessRow {...props} />)
    await vi.waitFor(() =>{  expect(screen.getByRole('button', { name: en.copy })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en.copy }))
    await vi.waitFor(() =>{  expect(screen.getByRole('button', { name: en.copied })).toBeTruthy() })
  } finally {
    if (prior === undefined) Reflect.deleteProperty(document, 'execCommand')
    else Object.defineProperty(document, 'execCommand', prior)
  }
})

it.each([false, true])('keeps a submitted account operation independent from a removed dialog (failure: %s)', async (failed) => {
  const pending = Promise.withResolvers<NeurixAccountState>()
  const state: NeurixAccountState = { configured: false, signedIn: false }
  const props = { wide: true, openSettings: vi.fn(), loadAccount: async () => state, register: () => pending.promise,
    signIn: vi.fn(), signOut: vi.fn(), t: makeTranslate(en, commonEn) } as NeurixMenuProps
  const view = render(<NeurixMenu {...props} />)
  fireEvent.click(screen.getByRole('button', { name: en.more }))
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: en.more }))
  fireEvent.click(screen.getByRole('menuitem', { name: en.signIn }))
  await vi.waitFor(() =>{  expect(screen.getByLabelText(en.password)).toBeTruthy() })
  fireEvent.submit(screen.getByLabelText(en.password).closest('form')!)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.getByRole('dialog')).toBeTruthy()
  view.unmount()
  await act(async () => { if (failed) pending.reject(new Error('fixture closed')); else pending.resolve({ configured: true, signedIn: true }) })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('labels phone logout separately from signing the computer out', async () => {
  const signOut = vi.fn(async () => ({ configured: true, signedIn: false }))
  const props = { wide: true, openSettings: vi.fn(),
    loadAccount: async () => ({ configured: true, signedIn: true, username: 'test.owner', phone: true }),
    register: vi.fn(), signIn: vi.fn(), signOut, t: makeTranslate(en, commonEn) } as NeurixMenuProps
  render(<NeurixMenu {...props} />)
  await vi.waitFor(() => { expect(screen.getByText('test.owner')).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: en.more }))
  fireEvent.click(screen.getByRole('menuitem', { name: en.accountTitle }))
  fireEvent.click(screen.getByRole('button', { name: en.signOutPhone }))
  await vi.waitFor(() => { expect(signOut).toHaveBeenCalledTimes(1) })
})
