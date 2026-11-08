/** Real repositories exercise branch discovery without index or checkout mutations. */
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { readHead } from '../src/head.ts'
import GitBranch from '../src/index.ts'

async function bench() {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-branch-'))
  onTestFinished(() => rm(cwd, { recursive: true, force: true }))
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(LocalSubprocessRuntime).await()
  const executable = await ctx.subprocess.resolveExecutable('git')
  const git = (...args: string[]) => execFileSync(executable, [
    '-c', 'user.name=Branch test', '-c', 'user.email=branch@example.com', '-c', 'commit.gpgsign=false', ...args,
  ], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  return {
    cwd, ctx, git,
    read: (path = cwd, signal = new AbortController().signal) => readHead(ctx.subprocess, executable, path, 30_000, signal),
  }
}

it('shows an unborn branch, nested working directory, branch switch, and detached HEAD', async () => {
  const b = await bench()
  b.git('init', '-q', '-b', 'main')
  expect(await b.read()).toEqual({ kind: 'branch', name: 'main' })
  await writeFile(join(b.cwd, 'file.txt'), 'tracked\n')
  b.git('add', '.')
  b.git('commit', '-qm', 'initial')
  await mkdir(join(b.cwd, 'nested'))
  expect(await b.read(join(b.cwd, 'nested'))).toEqual({ kind: 'branch', name: 'main' })
  b.git('checkout', '-qb', 'feature/中文-long-name')
  expect(await b.read()).toEqual({ kind: 'branch', name: 'feature/中文-long-name' })
  b.git('checkout', '-q', '--detach')
  expect(await b.read()).toEqual({ kind: 'detached', commit: b.git('rev-parse', '--short', 'HEAD') })
})

it('resolves linked worktrees and preserves the repository index and working files', async () => {
  const b = await bench()
  b.git('init', '-q', '-b', 'main')
  const file = join(b.cwd, 'file.txt')
  await writeFile(file, 'tracked\n')
  b.git('add', '.')
  b.git('commit', '-qm', 'initial')
  await writeFile(file, 'uncommitted\n')
  const index = await readFile(join(b.cwd, '.git', 'index'))
  const linked = join(b.cwd, 'linked')
  b.git('worktree', 'add', '-q', '-b', 'feature/linked', linked)
  expect(await b.read(linked)).toEqual({ kind: 'branch', name: 'feature/linked' })
  expect(await b.read()).toEqual({ kind: 'branch', name: 'main' })
  expect(await readFile(join(b.cwd, '.git', 'index'))).toEqual(index)
  expect(await readFile(file, 'utf8')).toBe('uncommitted\n')
})

it('distinguishes a non-repository, a bare repository, a broken HEAD, and cancellation', async () => {
  const b = await bench()
  expect(await b.read()).toEqual({ kind: 'not-repository' })
  b.git('init', '-q', '--bare')
  expect(await b.read()).toEqual({ kind: 'not-repository' })
  const nested = join(b.cwd, 'worktree')
  await mkdir(nested)
  b.git('init', '-q', '-b', 'main', nested)
  await writeFile(join(nested, '.git', 'config'), 'invalid Git config\n')
  await expect(b.read(nested)).rejects.toMatchObject({ code: 'git-branch/read-failed' })
  await expect(b.read(nested, AbortSignal.abort())).rejects.toThrow()
})

it('streams branch changes and cancels a pending refresh without keeping a child process alive', async () => {
  const b = await bench()
  b.git('init', '-q', '-b', 'main')
  const service = new GitBranch(b.ctx, { refreshMs: 1, timeoutMs: 30_000 })
  const abort = new AbortController()
  const stream = service.follow({ sessionId: SessionId('branch-stream'), workspaceRoot: b.cwd }, abort.signal)[Symbol.asyncIterator]()
  onTestFinished(async () => { abort.abort(); await stream.return?.() })
  expect((await stream.next()).value).toEqual({ kind: 'branch', name: 'main' })
  b.git('symbolic-ref', 'HEAD', 'refs/heads/feature/next')
  expect((await stream.next()).value).toEqual({ kind: 'branch', name: 'feature/next' })
  const pending = stream.next()
  abort.abort()
  expect(await pending).toEqual({ done: true, value: undefined })
})

it('reports unavailable Git without attempting a repository command', async () => {
  const b = await bench()
  vi.spyOn(b.ctx.subprocess, 'resolveExecutable').mockRejectedValueOnce(new Error('missing git'))
  const service = new GitBranch(b.ctx, { refreshMs: 1, timeoutMs: 30_000 })
  const values = []
  for await (const value of service.follow({ sessionId: SessionId('missing-git'), workspaceRoot: b.cwd }, new AbortController().signal)) values.push(value)
  expect(values).toEqual([{ kind: 'unavailable' }])
})
