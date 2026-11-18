// @vitest-environment jsdom
/** Settings interactions keep missing history visible and export only a confirmed successful result. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate, workspaceSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ResourceSnapshot } from '@deepseek-ai/dsh-client-resources/client'
import type {} from '../src/client/index.ts'
import type { DiagnosticFocus, DiagnosticList } from '../src/types.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DiagnosticsPage, type DiagnosticsProps } from '../src/client/Page.tsx'
import { en, zh } from '../src/client/locales.ts'
import * as reports from '../src/client/report.ts'
import { diagnosticData } from './fixtures.client.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function fixture(data = diagnosticData()) {
  const state = createSnapshotStore<ResourceSnapshot<DiagnosticList>>({ status: 'live', value: data, failure: undefined })
  const useSnapshot = bindSnapshotSelector(state)
  const addresses: string[] = []
  const openSession = vi.fn()
  const close = vi.fn()
  const bound: Partial<DiagnosticsProps> = {
    t: makeTranslate(en), close, openSession, releaseFocus: vi.fn(),
    useWorkspaces: bindSnapshotSelector(createSnapshotStore(workspaceSnapshot())),
    useSessions: bindSnapshotSelector(createSnapshotStore({ ids: [], byId: {}, phase: 'ready' as const, projectionsBySession: {} })),
    useFocus: bindSnapshotSelector(createSnapshotStore<DiagnosticFocus | undefined>(undefined)),
    useResource: ((address: string) => { addresses.push(address); return useSnapshot(value => value) }) as DiagnosticsProps['useResource'],
  }
  const props = bound as DiagnosticsProps
  return { state, props, addresses, close, openSession }
}

it('defaults to the selected conversation cwd while permitting an explicit all-project scope', () => {
  const { props, addresses } = fixture()
  const id = SessionId('current')
  props.useSessions = selector => selector({
    ids: [id], phase: 'ready', projectionsBySession: {},
    byId: { [id]: { id, displayTitle: 'Current', cwd: '/project/current', running: false, retainedBy: { mainView: 1 }, blank: false, updatedAt: 0 } },
  })
  render(<DiagnosticsPage {...props} />)
  expect(JSON.parse(new URL(addresses.at(-1)!).searchParams.get('query')!)).toMatchObject({ scope: { kind: 'cwd', cwd: '/project/current' } })
  fireEvent.click(screen.getByRole('combobox', { name: en.scope }))
  fireEvent.click(screen.getByRole('option', { name: en.all }))
  expect(JSON.parse(new URL(addresses.at(-1)!).searchParams.get('query')!)).toMatchObject({ scope: { kind: 'all' } })
})

it('opens the indexed source event from a card without a hidden history refresh', () => {
  const data = diagnosticData()
  const source = data.groups[0]!.occurrences[0]!
  const { props, addresses } = fixture(data)
  props.useFocus = bindSnapshotSelector(createSnapshotStore<DiagnosticFocus | undefined>({
    sessionId: source.sessionId, eventSeq: source.eventSeq,
  }))
  render(<DiagnosticsPage {...props} />)
  const address = new URL(addresses.at(-1)!)
  expect(JSON.parse(address.searchParams.get('query')!)).toMatchObject({ scope: { kind: 'session', sessionId: source.sessionId } })
  expect(address.searchParams.get('mode')).toBe('list')
  expect(screen.getByText('Event #2 · Turn 1')).toBeTruthy()
})

it('releases a consumed shortcut on unmount so a normal reopening uses its ordinary scope', () => {
  const data = diagnosticData()
  const source = data.groups[0]!.occurrences[0]!
  const pending = createSnapshotStore<DiagnosticFocus | undefined>({ sessionId: source.sessionId, eventSeq: source.eventSeq })
  const { props, addresses } = fixture(data)
  props.useFocus = bindSnapshotSelector(pending)
  props.releaseFocus = (consumed) => { if (pending.getSnapshot() === consumed) pending.set(undefined) }
  const opening = render(<DiagnosticsPage {...props} />)
  expect(JSON.parse(new URL(addresses.at(-1)!).searchParams.get('query')!)).toMatchObject({ scope: { kind: 'session' } })
  opening.unmount()
  expect(pending.getSnapshot()).toBeUndefined()
  render(<DiagnosticsPage {...props} />)
  expect(JSON.parse(new URL(addresses.at(-1)!).searchParams.get('query')!)).toMatchObject({ scope: { kind: 'all' } })
})

it('reports a missing source event rather than inventing its details', () => {
  const data = diagnosticData()
  const source = data.groups[0]!.occurrences[0]!
  data.groups = []
  const { props } = fixture(data)
  props.useFocus = bindSnapshotSelector(createSnapshotStore<DiagnosticFocus | undefined>({
    sessionId: source.sessionId, eventSeq: source.eventSeq,
  }))
  render(<DiagnosticsPage {...props} />)
  expect(screen.getByText(en.focusUnavailable)).toBeTruthy()
  expect(screen.queryByText('Event #2 · Turn 1')).toBeNull()
})

it('distinguishes an incomplete empty index from no matching failures and refreshes only explicitly', () => {
  const data = diagnosticData()
  data.groups = []
  data.incomplete = true
  data.unindexedSessions = 2
  const { props, addresses } = fixture(data)
  render(<DiagnosticsPage {...props} />)
  expect(screen.getByText(en.empty)).toBeTruthy()
  expect(screen.getByRole('status').textContent).toContain('Unindexed Sessions: 2')
  expect(screen.getByRole('button', { name: en.export }).hasAttribute('disabled')).toBe(true)
  expect(new URL(addresses.at(-1)!).searchParams.get('mode')).toBe('list')
  fireEvent.click(screen.getByRole('button', { name: en.refresh }))
  expect(new URL(addresses.at(-1)!).searchParams.get('mode')).toBe('refresh')
})

it('previews only selected groups, cancels without a download and confirms the frozen preview', () => {
  const download = vi.spyOn(reports, 'downloadDiagnosticReport').mockImplementation(() => {})
  const { props, state } = fixture()
  render(<DiagnosticsPage {...props} />)
  fireEvent.click(screen.getByRole('checkbox', { name: `${en.select}: Required field is missing` }))
  fireEvent.click(screen.getByRole('button', { name: 'Export selected (1)' }))
  let dialog = screen.getByRole('dialog', { name: en.preview })
  expect(dialog.textContent).toContain('INVALID_ARGS')
  expect(dialog.textContent).not.toContain('EXIT_60')
  fireEvent.click(within(dialog).getByRole('button', { name: en.cancel }))
  expect(download).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Export selected (1)' }))
  dialog = screen.getByRole('dialog', { name: en.preview })
  const preview = dialog.querySelector('pre')?.textContent
  act(() => { state.set({ ...state.getSnapshot(), value: { ...diagnosticData(), groups: [] } }) })
  fireEvent.click(within(dialog).getByRole('button', { name: en.download }))
  expect(download).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ json: preview }))
})

it('disables export for a failed resource even when a previous value is retained', () => {
  const { props, state } = fixture()
  render(<DiagnosticsPage {...props} />)
  act(() => { state.set({ ...state.getSnapshot(), status: 'failed' }) })
  expect(screen.getByRole('alert').textContent).toContain(en.failed)
  expect(screen.getByRole('button', { name: en.export }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: en.export }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('opens a source Session without pretending its event was automatically focused', () => {
  const { props, openSession, close } = fixture()
  render(<DiagnosticsPage {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /Required field is missing/ }))
  expect(screen.getByText(en.unknown)).toBeTruthy()
  expect(screen.getByText('Event #2 · Turn 1')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.source }))
  expect(openSession).toHaveBeenCalledExactlyOnceWith('session-0')
  expect(close).toHaveBeenCalledOnce()
})

it('keeps settings open and visibly reports source selection failures', () => {
  const { props, openSession, close } = fixture()
  openSession.mockImplementation(() => { throw new Error('removed Session') })
  render(<DiagnosticsPage {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /Required field is missing/ }))
  fireEvent.click(screen.getByRole('button', { name: en.source }))
  expect(screen.getByRole('alert').textContent).toContain(en.unavailable)
  expect(close).not.toHaveBeenCalled()
})

it('reports a local archive failure without claiming an upload or completed download', () => {
  vi.spyOn(reports, 'downloadDiagnosticReport').mockImplementation(() => { throw new Error('archive unavailable') })
  const { props } = fixture()
  render(<DiagnosticsPage {...props} />)
  fireEvent.click(screen.getByRole('button', { name: en.export }))
  fireEvent.click(screen.getByRole('button', { name: en.download }))
  expect(screen.getByRole('alert').textContent).toContain(en.exportFailed)
})

it('renders localized privacy and incomplete-index copy', () => {
  const data = diagnosticData()
  data.incomplete = true
  data.unindexedSessions = 1
  const { props } = fixture(data)
  render(<DiagnosticsPage {...props} t={makeTranslate(zh)} />)
  expect(screen.getByRole('heading', { name: zh.title })).toBeTruthy()
  expect(screen.getByRole('status').textContent).toContain('1 个会话未索引')
  fireEvent.click(screen.getByRole('button', { name: zh.export }))
  expect(screen.getByRole('dialog', { name: zh.preview }).textContent).toContain(zh.privacy)
})
