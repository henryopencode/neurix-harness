// @vitest-environment jsdom
/** Resource and feedback ownership through the real slot and locale registries. */

import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { apply, inject } from '../src/client/index.ts'
import type { BranchInjected } from '../src/client/BranchSelector.tsx'
import type { GitBranchState } from '../src/types.ts'

const id = SessionId('resource-branch')
const state: GitBranchState = { kind: 'repository', root: '/repo', current: 'main', commit: 'abc123', branches: [] }

afterEach(cleanup)

async function bench(error?: Error) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: {
    'conversation.input.dock': { kind: 'list', scope: 'session' },
    'conversation.hero.options': { kind: 'list', scope: 'session' },
    'shell.overlay': { kind: 'list', scope: 'root' },
  } } as never, () => null)
  ctx.provide('locale', new LocaleRuntime(ctx))
  let provider: ResourceProvider<'git-branch'> | undefined
  const released = vi.fn()
  ctx.provide('resources', { register: (value: ResourceProvider<'git-branch'>) => { provider = value; return released } } as never)
  const disposed = vi.fn(async () => {})
  const accepted = vi.fn()
  let ended: (() => Error) | undefined
  const follow = vi.fn(async function* () { yield state; if (error !== undefined) throw error })
  const checkout = vi.fn(async () => ({ ok: true as boolean, value: state, error: new RemoteError('git-branch/rejected', 'conflict', {}) }))
  const remote = {
    workspaceGit: { follow, checkout },
    $stream: (options: { open: (signal: AbortSignal) => AsyncIterable<GitBranchState>; ended: () => Error }) => {
      ended = options.ended
      return {
        async *[Symbol.asyncIterator]() {
          for await (const value of options.open(new AbortController().signal)) yield { value, accept: accepted }
        },
        dispose: disposed,
      }
    },
  }
  ctx.provide('remote', remote as never)
  ctx.provide('remote.workspaceGit', remote.workspaceGit as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber
  if (provider === undefined) throw new Error('branch resource did not register')
  return { ctx, provider, fiber, remote, disposed, accepted, released, ended: () => ended?.() }
}

function branchActions(ctx: Context): BranchInjected {
  const values = ctx.slots.entries('conversation.input.dock')[0]?.inject?.()
  return { checkout: values?.checkout as BranchInjected['checkout'], compact: false }
}

describe('Git branch browser plugin', () => {
  it('publishes branch resources and disposes registrations with the plugin', async () => {
    const f = await bench()
    const frames = []
    for await (const frame of f.provider.open(`dsh-resource://git-branch/${id}`, { signal: new AbortController().signal })) frames.push(frame)
    expect(frames).toEqual([{ ok: true, value: state }])
    expect(f.remote.workspaceGit.follow.mock.calls).toHaveLength(1)
    expect(f.accepted).toHaveBeenCalledOnce()
    expect(f.disposed).toHaveBeenCalledOnce()
    expect(f.ended()).toMatchObject({ code: 'git-branch/read-failed' })
    expect(f.ctx.slots.entries('conversation.input.dock')).toHaveLength(1)
    expect(f.ctx.slots.entries('conversation.hero.options')[0]?.inject?.().compact).toBe(true)
    await f.fiber.dispose()
    expect(f.released).toHaveBeenCalledOnce()
    expect(f.ctx.slots.entries('conversation.input.dock')).toHaveLength(0)
    expect(f.ctx.slots.entries('conversation.hero.options')).toHaveLength(0)
    expect(f.ctx.slots.entries('shell.overlay')).toHaveLength(0)
  })

  it.each([new RemoteError('git-branch/read-failed', 'Git failed', {}), new Error('carrier stopped')])
  ('reports observation failures as resource frames and still releases the stream', async (error) => {
    const f = await bench(error)
    const frames = []
    for await (const frame of f.provider.open(`dsh-resource://git-branch/${id}`, { signal: new AbortController().signal })) frames.push(frame)
    expect(frames).toHaveLength(2)
    expect(frames[1]).toMatchObject({ ok: false, error: { code: 'git-branch/read-failed' } })
    expect(f.disposed).toHaveBeenCalledOnce()
  })

  it('does not start a cancelled resource', async () => {
    const f = await bench()
    const frames = []
    for await (const frame of f.provider.open(`dsh-resource://git-branch/${id}`, { signal: AbortSignal.abort() })) frames.push(frame)
    expect(frames).toEqual([])
    expect(f.remote.workspaceGit.follow).not.toHaveBeenCalled()
    expect(f.disposed).toHaveBeenCalledOnce()
  })

  it('cancels an active stream when its resource is released', async () => {
    const f = await bench()
    const lifetime = new AbortController()
    const stream = f.provider.open(`dsh-resource://git-branch/${id}`, { signal: lifetime.signal })[Symbol.asyncIterator]()
    expect((await stream.next()).value).toEqual({ ok: true, value: state })
    lifetime.abort()
    await stream.return?.()
    expect(f.disposed).toHaveBeenCalledTimes(2)
  })

  it('does not report a cancelled observation as a read failure', async () => {
    const f = await bench(new Error('stream cancelled'))
    const lifetime = new AbortController()
    const stream = f.provider.open(`dsh-resource://git-branch/${id}`, { signal: lifetime.signal })[Symbol.asyncIterator]()
    await stream.next()
    lifetime.abort()
    expect((await stream.next()).done).toBe(true)
  })

  it('reports operation outcomes through the shell overlay', async () => {
    const f = await bench()
    const face = branchActions(f.ctx)
    const noticeFace = f.ctx.slots.entries('shell.overlay')[0]?.inject?.() as {
      hooks: { branchNotice: HostObservable<{ seq: number; text: string; success: boolean } | null> }
      dismiss: () => void
    }
    const Notice = f.ctx.slots.entries('shell.overlay')[0]?.component as ComponentType<{
      useBranchNotice: SnapshotSelectorHook<{ seq: number; text: string; success: boolean } | null>
      dismiss: () => void
    }>
    render(<Notice useBranchNotice={bindSnapshotSelector(noticeFace.hooks.branchNotice)} dismiss={noticeFace.dismiss} />)
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => { await face.checkout(id, 'feature', 'main') })
    expect(noticeFace.hooks.branchNotice.getSnapshot()).toMatchObject({ success: true, text: 'Switched to feature' })
    expect(screen.getByRole('alert').textContent).toBe('Switched to feature')
    f.remote.workspaceGit.checkout.mockResolvedValue({ ok: false, value: state, error: new RemoteError('git-branch/rejected', 'conflict', {}) })
    await act(async () => { await face.checkout(id, 'feature', 'main') })
    expect(noticeFace.hooks.branchNotice.getSnapshot()).toMatchObject({ success: false, text: 'Could not switch branches. Check local changes and other worktrees.' })
    act(() => { noticeFace.dismiss() })
    expect(noticeFace.hooks.branchNotice.getSnapshot()).toBeNull()
  })

  it.each([
    ['git-branch/busy', 'This working tree is busy. Wait for current operations to finish.'],
    ['git-branch/stale', 'The branch changed. Open the list again and retry.'],
    ['gateway/internal', 'The switch could not be verified. Check the current branch and working files.'],
  ] as const)('reports %s with its recovery action', async (code, text) => {
    const f = await bench()
    const face = branchActions(f.ctx)
    const noticeFace = f.ctx.slots.entries('shell.overlay')[0]?.inject?.() as {
      hooks: { branchNotice: { getSnapshot: () => { text: string } | null } }
    }
    f.remote.workspaceGit.checkout.mockResolvedValue({ ok: false, value: state, error: new RemoteError(code, 'failed', {}) as never })
    await face.checkout(id, 'feature', 'main')
    expect(noticeFace.hooks.branchNotice.getSnapshot()?.text).toBe(text)
  })
})
