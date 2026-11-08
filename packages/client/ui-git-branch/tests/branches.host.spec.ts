/** Branch operations against private real Git repositories and the managed subprocess provider. */

import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import WorkspaceGit, { type Config } from '../src/index.ts'
import type { GitBranchState } from '../src/types.ts'

const execute = promisify(execFile)

async function fixture(commit = true, options: Partial<Config> = {}, directoryName = 'repo') {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'dsh-branches-')))
  const root = join(parent, directoryName)
  const ctx = new Context()
  onTestFinished(async () => {
    try { await ctx.fiber.dispose() }
    finally { await rm(parent, { recursive: true, force: true }) }
  })
  await mkdir(root)
  const git = async (...args: string[]): Promise<string> => (await execute('git', args, {
    cwd: root,
    env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '', GIT_CONFIG_COUNT: '0', GIT_CONFIG_PARAMETERS: '' },
  })).stdout.trim()
  await git('init', '-b', 'main')
  await git('config', 'user.name', 'Branch fixture')
  await git('config', 'user.email', 'branch@example.invalid')
  await git('config', 'commit.gpgSign', 'false')
  if (commit) {
    await writeFile(join(root, 'file.txt'), 'initial\n')
    await git('add', 'file.txt')
    await git('commit', '-m', 'initial')
    await git('branch', 'feature')
  }
  await ctx.plugin(LocalSubprocessRuntime)
  let busy = false
  ctx.provide('agents', { list: () => busy ? [{ status: 'running', session: { header: { cwd: join(root, 'subdir') } } }] : [] } as never)
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'danger-full-access', workspaceRoot: root }) } as never)
  const service = new WorkspaceGit(ctx, WorkspaceGit.Config({ refreshIntervalMs: 60_000, ...options }))
  const id = SessionId('branch-fixture')
  const session = Session.create(id, [], { id, version: SESSION_FORMAT_VERSION, createdAt: 0, isSeeded: false, cwd: root })
  const inspect = async (target = session): Promise<GitBranchState> => {
    const lifetime = new AbortController()
    const stream = service.follow(target, lifetime.signal)[Symbol.asyncIterator]()
    try {
      const next = await stream.next()
      if (next.done) throw new Error('branch observation ended before its first value')
      return next.value
    }
    finally { lifetime.abort(); await stream.return?.() }
  }
  return { ctx, parent, root, service, session, git, inspect, busy: () => { busy = true } }
}

function scripted(
  f: Awaited<ReturnType<typeof fixture>>,
  outputs: { exitCode?: number; stdout?: string; stderr?: string; lossy?: boolean }[],
) {
  const terminated = vi.fn()
  const settled = vi.fn(async () => {})
  const spy = vi.spyOn(f.ctx.subprocess, 'spawn').mockImplementation(() => {
    const output = outputs.shift()
    if (output === undefined) throw new Error('unexpected Git command')
    return {
      done: Promise.resolve({ exitCode: output.exitCode ?? 0, signal: null }),
      collected: {
        stdout: { readFrom: () => ({ text: output.stdout ?? '', lossy: output.lossy ?? false }) },
        stderr: { readFrom: () => ({ text: output.stderr ?? '', lossy: false }) },
      },
      terminate: terminated, waitForExit: settled,
    } as never
  })
  onTestFinished(() => { spy.mockRestore() })
  return { terminated, settled, spy }
}

const mainRefs = 'feature\0 \0abc123\0\nmain\0*\0abc123\0/repo\n'

describe('Session Git branches', () => {
  it.each([
    { timeoutMs: 2_147_483_648 }, { graceMs: 2_147_483_648 }, { refreshIntervalMs: 2_147_483_648 }, { maxOutputBytes: 0 },
  ])('rejects unsupported process limits %j at load', (config) => {
    expect(() => WorkspaceGit.Config(config)).toThrow()
  })

  it('reads local branches and switches without discarding unrelated local edits', async () => {
    const f = await fixture()
    await f.git('tag', 'feature')
    await writeFile(join(f.root, 'untracked.txt'), 'keep me\n')
    expect(await f.inspect()).toMatchObject({ kind: 'repository', current: 'main', branches: [
      { name: 'feature', occupied: false }, { name: 'main', occupied: false },
    ] })
    const state = await f.service.checkout(f.session, 'feature', 'main', new AbortController().signal)
    expect(state).toMatchObject({ current: 'feature' })
    expect(await f.git('branch', '--show-current')).toBe('feature')
    expect(await readFile(join(f.root, 'untracked.txt'), 'utf8')).toBe('keep me\n')
  })

  it('keeps conflicting edits and the current branch when Git refuses a switch', async () => {
    const f = await fixture()
    await f.git('switch', 'feature')
    await writeFile(join(f.root, 'file.txt'), 'feature\n')
    await f.git('commit', '-am', 'feature')
    await f.git('switch', 'main')
    await writeFile(join(f.root, 'file.txt'), 'local edit\n')
    await expect(f.service.checkout(f.session, 'feature', 'main', new AbortController().signal))
      .rejects.toMatchObject({ code: 'git-branch/rejected' })
    expect(await f.git('branch', '--show-current')).toBe('main')
    expect(await readFile(join(f.root, 'file.txt'), 'utf8')).toBe('local edit\n')
  })

  it('protects ignored local files that the target branch would overwrite', async () => {
    const f = await fixture()
    await writeFile(join(f.root, '.gitignore'), 'ignored.txt\n')
    await f.git('add', '.gitignore')
    await f.git('commit', '-m', 'ignore local file')
    await f.git('switch', 'feature')
    await writeFile(join(f.root, 'ignored.txt'), 'tracked on feature\n')
    await f.git('add', 'ignored.txt')
    await f.git('commit', '-m', 'track file')
    await f.git('switch', 'main')
    await writeFile(join(f.root, 'ignored.txt'), 'local data\n')
    await expect(f.service.checkout(f.session, 'feature', 'main', new AbortController().signal))
      .rejects.toMatchObject({ code: 'git-branch/rejected' })
    expect(await f.git('branch', '--show-current')).toBe('main')
    expect(await readFile(join(f.root, 'ignored.txt'), 'utf8')).toBe('local data\n')
  })

  it('refuses stale selections, unknown branches, and running work in the repository', async () => {
    const f = await fixture()
    await expect(f.service.checkout(f.session, 'feature', 'old', new AbortController().signal))
      .rejects.toMatchObject({ code: 'git-branch/stale' })
    await expect(f.service.checkout(f.session, '--discard-changes', 'main', new AbortController().signal))
      .rejects.toMatchObject({ code: 'git-branch/rejected' })
    f.busy()
    await expect(f.service.checkout(f.session, 'feature', 'main', new AbortController().signal))
      .rejects.toMatchObject({ code: 'git-branch/busy' })
    expect(await f.git('branch', '--show-current')).toBe('main')
  })

  // Windows directory symlink creation requires host privileges; POSIX owns this path-spelling regression.
  it.skipIf(process.platform === 'win32')('blocks the running Session even when its directory is a symlink', async () => {
    const f = await fixture()
    const alias = join(f.parent, 'alias')
    await symlink(f.root, alias)
    const id = SessionId('linked-directory')
    const session = Session.create(id, [], { id, version: SESSION_FORMAT_VERSION, createdAt: 0, isSeeded: false, cwd: alias })
    vi.spyOn(f.ctx.agents, 'list').mockReturnValue([{ id, session, status: 'running' }] as never)
    await expect(f.service.checkout(session, 'feature', 'main', new AbortController().signal))
      .rejects.toMatchObject({ code: 'git-branch/busy' })
    expect(await f.git('branch', '--show-current')).toBe('main')
  })

  // Ordinary Windows paths normalize trailing spaces before Git receives them.
  it.skipIf(process.platform === 'win32')('preserves trailing spaces in the working-tree root', async () => {
    const f = await fixture(true, {}, 'repo ')
    expect(await f.inspect()).toMatchObject({ root: f.root })
    expect(await f.service.checkout(f.session, 'feature', 'main', new AbortController().signal)).toMatchObject({ current: 'feature' })
    expect(await f.git('branch', '--show-current')).toBe('feature')
  })

  it('admits only one branch switch per working tree', async () => {
    const f = await fixture()
    const entered = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    const original = f.ctx.subprocess.resolveExecutable.bind(f.ctx.subprocess)
    let lookups = 0
    const spy = vi.spyOn(f.ctx.subprocess, 'resolveExecutable').mockImplementation(async (...args) => {
      // The first two lookups inspect the checkout; hold the admitted switch before spawning it.
      if (++lookups === 3) { entered.resolve(undefined); await resume.promise }
      return original(...args)
    })
    const first = f.service.checkout(f.session, 'feature', 'main', new AbortController().signal)
    try {
      await entered.promise
      await expect(f.service.checkout(f.session, 'feature', 'main', new AbortController().signal))
        .rejects.toMatchObject({ code: 'git-branch/busy' })
    } finally { resume.resolve(undefined); spy.mockRestore(); await first }
    expect(await f.git('branch', '--show-current')).toBe('feature')
  })

  it('identifies a branch occupied by another worktree and a detached HEAD', async () => {
    const f = await fixture()
    await f.git('worktree', 'add', join(f.parent, 'other'), 'feature')
    expect(await f.inspect()).toMatchObject({ branches: [{ name: 'feature', occupied: true }, { name: 'main', occupied: false }] })
    await expect(f.service.checkout(f.session, 'feature', 'main', new AbortController().signal))
      .rejects.toMatchObject({ code: 'git-branch/rejected' })
    await f.git('switch', '--detach')
    const commit = await f.git('rev-parse', '--short', 'HEAD')
    expect(await f.inspect()).toMatchObject({ kind: 'repository', current: null, commit })
    expect(await f.service.checkout(f.session, 'main', commit, new AbortController().signal)).toMatchObject({ current: 'main' })
  })

  it('shows the unborn branch and omits directories outside Git', async () => {
    const f = await fixture(false)
    expect(await f.inspect()).toEqual({ kind: 'repository', root: f.root, current: 'main', commit: null, branches: [] })
    const id = SessionId('outside')
    const outside = Session.create(id, [], { id, version: SESSION_FORMAT_VERSION, createdAt: 0, isSeeded: false, cwd: f.parent })
    expect(await f.inspect(outside)).toEqual({ kind: 'unavailable' })
    const noDirectoryId = SessionId('without-directory')
    const noDirectory = Session.create(noDirectoryId, [], {
      id: noDirectoryId, version: SESSION_FORMAT_VERSION, createdAt: 0, isSeeded: false,
    })
    expect(await f.inspect(noDirectory)).toEqual({ kind: 'unavailable' })
    await expect(f.service.checkout(noDirectory, 'feature', 'main', new AbortController().signal))
      .rejects.toMatchObject({ code: 'git-branch/stale' })
  })

  it('leaves the current branch alone and ignores Agents outside the working tree', async () => {
    const f = await fixture()
    expect(await f.service.checkout(f.session, 'main', 'main', new AbortController().signal)).toMatchObject({ current: 'main' })
    vi.spyOn(f.ctx.agents, 'list').mockReturnValue([
      { status: 'idle', session: { header: { cwd: f.root } } },
      { status: 'running', session: { header: {} } },
      { status: 'running', session: { header: { cwd: f.parent } } },
    ] as never)
    expect(await f.service.checkout(f.session, 'feature', 'main', new AbortController().signal)).toMatchObject({ current: 'feature' })
  })

  it('applies the Session sandbox policy to Git inspection', async () => {
    const f = await fixture()
    const policy = { mode: 'workspace-write', workspaceRoot: f.root, extraWritableRoots: [] } as const
    vi.spyOn(f.ctx.sandboxPolicy, 'resolve').mockReturnValue(policy)
    const confine = vi.fn(async (argv: readonly string[], _policy: object) => ({ argv }))
    f.ctx.provide('sandbox', { confine } as never)
    expect(await f.inspect()).toMatchObject({ current: 'main' })
    expect(confine.mock.calls[0]?.[1]).toMatchObject(policy)
  })

  it.each([
    [{ exitCode: 1, stderr: 'directory unreadable' }],
    [{ stdout: '/repo\n' }, { exitCode: 1, stderr: 'refs unreadable' }],
    [{ stdout: '/repo\n' }, { stdout: 'incomplete\n' }],
    [{ stdout: '/repo\n' }, { stdout: '' }, { exitCode: 128, stderr: 'HEAD unreadable' }],
    [{ stdout: '/repo\n' }, { stdout: '' }, { exitCode: 1 }, { exitCode: 128, stderr: 'commit unreadable' }],
    [{ stdout: '/repo\n', lossy: true }],
  ])('reports incomplete or failed Git reads and awaits child termination', async (...outputs) => {
    const f = await fixture()
    const subprocess = scripted(f, outputs)
    await expect(f.inspect()).rejects.toMatchObject({ code: 'git-branch/read-failed' })
    expect(subprocess.terminated).toHaveBeenCalled()
    expect(subprocess.settled).toHaveBeenCalledTimes(subprocess.terminated.mock.calls.length)
  })

  it('rejects output beyond the configured capture bound', async () => {
    const f = await fixture(true, { maxOutputBytes: 1 })
    await expect(f.inspect()).rejects.toMatchObject({ code: 'git-branch/read-failed' })
  })

  it('reports a checkout changed by an external client after Git exits', async () => {
    const f = await fixture()
    scripted(f, [{ stdout: '/repo\n' }, { stdout: mainRefs }, {}, { stdout: '/repo\n' }, { stdout: mainRefs }])
    await expect(f.service.checkout(f.session, 'feature', 'main', new AbortController().signal))
      .rejects.toMatchObject({ code: 'git-branch/stale' })
  })

  it('reports a Git refusal even when Git supplies no stderr', async () => {
    const f = await fixture()
    scripted(f, [{ stdout: '/repo\n' }, { stdout: mainRefs }, { exitCode: 1 }])
    await expect(f.service.checkout(f.session, 'feature', 'main', new AbortController().signal))
      .rejects.toMatchObject({ code: 'git-branch/rejected', message: 'Git refused the branch switch.' })
  })

  it('disables checkout hooks with the Windows null device', async () => {
    const f = await fixture()
    vi.spyOn(f.ctx.subprocess, 'resolveExecutable').mockResolvedValue('git')
    vi.spyOn(f.ctx.subprocess, 'terminalEnvironment').mockResolvedValue({ platform: 'windows' })
    const child = scripted(f, [{ stdout: '/repo\n' }, { stdout: mainRefs }, { exitCode: 1 }])
    await expect(f.service.checkout(f.session, 'feature', 'main', new AbortController().signal))
      .rejects.toMatchObject({ code: 'git-branch/rejected' })
    expect(child.spy.mock.lastCall?.[0].argv).toContain('core.hooksPath=NUL')
  })

  it('refreshes an open subscription after switching and settles cancellation', async () => {
    const f = await fixture()
    const lifetime = new AbortController()
    const stream = f.service.follow(f.session, lifetime.signal)[Symbol.asyncIterator]()
    try {
      expect((await stream.next()).value).toMatchObject({ current: 'main' })
      const changed = stream.next()
      f.ctx.emit('workspace-git/changed', '/another-working-tree')
      await f.service.checkout(f.session, 'feature', 'main', lifetime.signal)
      expect((await changed).value).toMatchObject({ current: 'feature' })
      const finished = stream.next()
      lifetime.abort()
      expect((await finished).done).toBe(true)
    } finally { lifetime.abort(); await stream.return?.() }
  })

  it('settles cancellation between delivering a value and starting its wait', async () => {
    const f = await fixture()
    const lifetime = new AbortController()
    const stream = f.service.follow(f.session, lifetime.signal)[Symbol.asyncIterator]()
    await stream.next()
    lifetime.abort()
    expect((await stream.next()).done).toBe(true)
    const alreadyAborted = f.service.follow(f.session, AbortSignal.abort())[Symbol.asyncIterator]()
    expect((await alreadyAborted.next()).done).toBe(true)
  })

  it('ignores branch notifications for a Session without a working directory', async () => {
    const f = await fixture()
    const id = SessionId('without-git')
    const session = Session.create(id, [], { id, version: SESSION_FORMAT_VERSION, createdAt: 0, isSeeded: false })
    const lifetime = new AbortController()
    const stream = f.service.follow(session, lifetime.signal)[Symbol.asyncIterator]()
    await stream.next()
    const next = stream.next()
    f.ctx.emit('workspace-git/changed', f.root)
    lifetime.abort()
    expect((await next).done).toBe(true)
  })
})
