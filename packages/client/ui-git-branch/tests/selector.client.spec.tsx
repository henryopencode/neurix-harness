// @vitest-environment jsdom
/** Branch selection, filtering, failure recovery, and keyboard dismissal. */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { BranchSelector, ComposerBranchSelector, type BranchSelectorProps, type ComposerBranchSelectorProps } from '../src/client/BranchSelector.tsx'
import { en } from '../src/client/locales.ts'
import type { GitBranchState } from '../src/types.ts'

afterEach(cleanup)

const id = SessionId('branch-ui')
const state: GitBranchState = {
  kind: 'repository', root: '/project', current: 'main', commit: 'abc1234',
  branches: [{ name: 'main', occupied: false }, { name: 'Feature/long-name', occupied: false }, { name: 'occupied', occupied: true }],
}

function bench(value: GitBranchState | undefined = state, options: {
  running?: boolean
  failed?: boolean
  loading?: boolean
  noDirectory?: boolean
  cwd?: string
} = {}) {
  if (options.loading) value = undefined
  const checkout = vi.fn(async () => {})
  const resource = vi.fn((_address: string) => ({
    status: options.failed ? 'failed' : value === undefined ? 'loading' : 'live', value, failure: undefined,
  }))
  const props = {
    sessionId: id, checkout, compact: false, useResource: resource, t: makeTranslate(en),
    useSessions: (selector: (snapshot: object) => unknown) => selector({ byId: { [id]: {
      cwd: options.noDirectory ? undefined : options.cwd ?? '/project', running: options.running ?? false,
    } } }),
  } as BranchSelectorProps
  return { props, checkout, resource }
}

describe('Session branch selector', () => {
  it('uses the Hero workspace row while blank and the directory context above an active composer', () => {
    const f = bench()
    const props = { ...f.props, session: { blank: true } } as ComposerBranchSelectorProps
    const view = render(<ComposerBranchSelector {...props} />)
    expect(view.container.innerHTML).toBe('')
    view.rerender(<ComposerBranchSelector {...props} session={{ ...props.session, blank: false }} />)
    expect(screen.getByText('project')).toBeTruthy()
    view.rerender(<BranchSelector {...f.props} compact />)
    expect(screen.queryByText('project')).toBeNull()
    expect(screen.getByRole('button', { name: 'Switch Git branch: main' })).toBeTruthy()
  })

  it('shows the branch and searches local names without changing the checkout', () => {
    const f = bench()
    render(<BranchSelector {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch Git branch: main' }))
    expect(screen.getByRole('menuitem', { name: 'main' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('menuitem', { name: /occupied.*In another worktree/ })).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'FEATURE' } })
    expect(screen.getAllByRole('menuitem')).toHaveLength(1)
    expect(screen.getByRole('menuitem', { name: 'Feature/long-name' })).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } })
    expect(screen.getByText(en['branch.empty'])).toBeTruthy()
    expect(f.checkout).not.toHaveBeenCalled()
  })

  it('switches once, disables the trigger while pending, and returns focus on Escape', async () => {
    const f = bench()
    const pending = Promise.withResolvers<undefined>()
    f.checkout.mockImplementation(() => pending.promise)
    render(<BranchSelector {...f.props} />)
    const trigger = screen.getByRole('button', { name: 'Switch Git branch: main' })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Feature/long-name' }))
    expect(f.checkout).toHaveBeenCalledExactlyOnceWith(id, 'Feature/long-name', 'main')
    expect(trigger).toHaveProperty('disabled', true)
    await act(async () => { pending.resolve(undefined) })
    expect(trigger).toHaveProperty('disabled', false)
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps running Sessions inspectable while disabling branch changes', () => {
    const f = bench(state, { running: true })
    render(<BranchSelector {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch Git branch: main' }))
    expect(screen.getByText(en['branch.busy'])).toBeTruthy()
    expect(screen.getAllByRole('menuitem').every(item => (item as HTMLButtonElement).disabled)).toBe(true)
  })

  it('ignores the current branch and closes on an outside pointer', () => {
    const f = bench()
    render(<BranchSelector {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch Git branch: main' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'main' }))
    expect(f.checkout).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Switch Git branch: main' }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('displays detached and unborn checkouts and hides non-repositories', () => {
    const detached = bench({ ...state, current: null, commit: 'abc1234' })
    render(<BranchSelector {...detached.props} />)
    expect(screen.getByText('Detached at abc1234')).toBeTruthy()
    cleanup()
    const unborn = bench({ ...state, branches: [], commit: null })
    render(<BranchSelector {...unborn.props} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(en['branch.unborn'])).toBeTruthy()
    cleanup()
    const outside = render(<BranchSelector {...bench({ kind: 'unavailable' }).props} />)
    expect(outside.container.innerHTML).toBe('')
    cleanup()
    const loading = render(<BranchSelector {...bench(undefined, { loading: true }).props} />)
    expect(loading.container.innerHTML).toBe('')
  })

  it('retains the last checkout on read failure and retries through a new resource lifetime', () => {
    const f = bench(state, { failed: true })
    render(<BranchSelector {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch Git branch: main' }))
    expect(screen.getByRole('alert').textContent).toBe(en['branch.loadFailed'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retry' }))
    expect(f.resource.mock.lastCall?.[0]).toContain('revision=1')
  })

  it('offers recovery when the first Git read fails', () => {
    const f = bench(undefined, { failed: true, loading: true, noDirectory: true })
    render(<BranchSelector {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch Git branch: Git branches unavailable' }))
    expect(screen.getByRole('alert').textContent).toBe(en['branch.loadFailed'])
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('keeps a filesystem root visible as the directory label', () => {
    const f = bench({ ...state, root: '/' }, { cwd: '/' })
    render(<BranchSelector {...f.props} />)
    expect(screen.getByText('/')).toBeTruthy()
  })

  it('uses the displayed commit when switching from detached HEAD', async () => {
    const f = bench({ ...state, current: null, commit: 'abc1234' })
    render(<BranchSelector {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch Git branch: Detached at abc1234' }))
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Feature/long-name' })) })
    expect(f.checkout).toHaveBeenCalledWith(id, 'Feature/long-name', 'abc1234')
  })
})
