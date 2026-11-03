// @vitest-environment jsdom
/** Settings persistence, validation, localization, and component teardown. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type {} from '../src/client/index.ts'
import { BrowserCard, type BrowserCardProps } from '../src/client/BrowserCard.tsx'
import { BrowserCardController, type BrowserSettings } from '../src/client/controller.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

function bench() {
  const host = stubConfigForm<BrowserSettings>()
  host.publish({ status: 'ready', writable: true, revision: 3, value: {
    requireInputApproval: false,
    browserChannel: 'chrome', screenshots: false, operationTimeoutMs: 15_000, navigationTimeoutMs: 30_000,
  }, base: {}, user: {} })
  const controller = new BrowserCardController(host.scope)
  const { hooks, ...actions } = controller.inject()
  const props = { ...actions, view: 'page', t: makeTranslate(en, commonEn), useBrowserCard: bindSnapshotSelector(hooks.browserCard) } as BrowserCardProps
  return { host, controller, props, hooks }
}

it('shows screenshot-free defaults and localized settings without a manual test section', () => {
  const b = bench()
  try {
    const view = render(<BrowserCard {...b.props} />)
    expect(screen.getByLabelText(en.screenshots)).toHaveProperty('checked', false)
    expect(screen.queryByLabelText('Hide browser windows')).toBeNull()
    expect(screen.getByLabelText(en.browserChannel)).toHaveProperty('value', 'chrome')
    expect(screen.queryByLabelText('Show agent cursor and key indicators')).toBeNull()
    expect(screen.getByText(en.advancedSettings).closest('details')?.hasAttribute('open')).toBe(false)
    expect(screen.queryByRole('combobox', { name: 'Input mode' })).toBeNull()
    expect(view.container.querySelector('textarea')).toBeNull()
    view.rerender(<BrowserCard {...b.props} t={makeTranslate(zh, commonZh)} />)
    expect(screen.getByText(zh.newSessions)).toBeTruthy()
    expect(view.container.querySelector('textarea')).toBeNull()
    view.rerender(<BrowserCard {...b.props} view="summary" />)
    expect(view.container.textContent).toBe(en.description)
  } finally { b.controller.dispose() }
})

it('submits all staged choices in one revision-fenced save', async () => {
  const b = bench()
  try {
    b.host.mutate.mockResolvedValue(true)
    render(<BrowserCard {...b.props} />)
    fireEvent.change(screen.getByLabelText(en.browserChannel), { target: { value: 'msedge' } })
    fireEvent.click(screen.getByLabelText(en.screenshots))
    fireEvent.change(screen.getByLabelText(en.operationTimeoutMs), { target: { value: '20000' } })
    fireEvent.change(screen.getByLabelText(en.navigationTimeoutMs), { target: { value: '40000' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await vi.waitFor(() => { expect(b.host.mutate).toHaveBeenCalledExactlyOnceWith([
      { op: 'set', path: ['browserChannel'], value: 'msedge' },
      { op: 'set', path: ['screenshots'], value: true },
      { op: 'set', path: ['operationTimeoutMs'], value: 20_000 }, { op: 'set', path: ['navigationTimeoutMs'], value: 40_000 },
    ], 3) })
  } finally { b.controller.dispose() }
})

it.each(['', '0', '-1', '1.5', '2147483648', 'invalid'])('keeps invalid timeout %s local and prevents saving it', (value) => {
  const b = bench()
  try {
    render(<BrowserCard {...b.props} />)
    fireEvent.change(screen.getByLabelText(en.operationTimeoutMs), { target: { value } })
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    expect(b.host.mutate).not.toHaveBeenCalled()
  } finally { b.controller.dispose() }
})

it('retains drafts after a refused save and disables controls on a read-only connection', async () => {
  const b = bench()
  try {
    b.host.mutate.mockResolvedValue(false)
    render(<BrowserCard {...b.props} />)
    fireEvent.change(screen.getByLabelText(en.operationTimeoutMs), { target: { value: '25000' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await vi.waitFor(() => { expect(screen.getByText(en.saveFailed)).toBeTruthy() })
    expect(screen.getByLabelText(en.operationTimeoutMs)).toHaveProperty('value', '25000')
    b.host.publish({ writable: false })
    await vi.waitFor(() => { expect(screen.getByLabelText(en.browserChannel)).toHaveProperty('disabled', true) })
  } finally { b.controller.dispose() }
})

it.each(['browserChannel', 'operationTimeoutMs', 'navigationTimeoutMs'] as const)(
  'keeps the overridden %s value editable without override controls', (field) => {
    const b = bench()
    try {
      const defaults = b.host.scope.getSnapshot().value
      if (defaults === undefined) throw new Error('Missing fixture defaults')
      const changed = field === 'browserChannel' ? 'msedge' : 45_000
      b.host.publish({ base: defaults, user: { [field]: changed }, value: { ...defaults, [field]: changed } })
      render(<BrowserCard {...b.props} />)
      expect(screen.queryByText(en.overridden)).toBeNull()
      expect(screen.queryByRole('button', { name: en.reset })).toBeNull()
      expect(screen.getByLabelText(en[field])).toHaveProperty('value', String(changed))
      fireEvent.change(screen.getByLabelText(en[field]), { target: { value: String(defaults[field]) } })
      expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', false)
      expect(b.hooks.browserCard.getSnapshot()[field].text).toBe(String(defaults[field]))
    } finally { b.controller.dispose() }
  },
)

it('disables an unavailable form and rejects invalid browser or boolean drafts', () => {
  const b = bench()
  try {
    const face = b.controller.inject()
    face.edit('browserChannel', 'unknown-browser')
    expect(b.hooks.browserCard.getSnapshot().invalid).toBe(true)
    face.discard()
    face.edit('screenshots', 'not-a-boolean')
    expect(b.hooks.browserCard.getSnapshot().invalid).toBe(true)
    b.host.publish({ status: 'unavailable', value: undefined })
    render(<BrowserCard {...b.props} />)
    expect(screen.getByText(en.unavailable)).toBeTruthy()
  } finally { b.controller.dispose() }
})
