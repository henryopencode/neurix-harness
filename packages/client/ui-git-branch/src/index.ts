/** Session-authorized Git checkout inspection and non-forcing local branch switches. */

import { posix, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubprocessCollectedOutputs } from '@deepseek-ai/dsh-subprocess'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { GitBranchState } from './types.ts'

export type { GitBranch, GitBranchState } from './types.ts'

/** Process bounds and refresh cadence for the branch selector. */
export interface Config {
  /** Maximum duration of one Git subprocess, including executable resolution. */
  timeoutMs: number
  /** Maximum captured bytes per Git output stream; truncation fails the read. */
  maxOutputBytes: number
  /** Grace period before a cancelled Git process is killed. */
  graceMs: number
  /** Interval between observations of external branch changes. */
  refreshIntervalMs: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the Session Git branch API. */
    workspaceGit: WorkspaceGit
  }
  interface Events {
    /**
     * A branch switch has completed in a working tree.
     * @param root - Absolute repository working-tree root.
     * @mode parallel
     */
    'workspace-git/changed'(root: string): void
  }
}

/** Remove inherited Git selectors so the Session directory selects the repository. */
const GIT_ENV: NodeJS.ProcessEnv = Object.fromEntries([
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_CEILING_DIRECTORIES', 'GIT_PREFIX', 'GIT_SHALLOW_FILE', 'GIT_GRAFT_FILE',
  'GIT_REPLACE_REF_BASE', 'GIT_ATTR_SOURCE',
].map(key => [key, undefined]))

/** Git service scoped to a live Session; it never creates, resets, stashes, or force-checks out branches. */
export default class WorkspaceGit extends TypertRemoteService {
  static inject = ['sessions', 'agents', 'subprocess', 'sandbox', 'sandboxPolicy']

  private readonly switching = new Set<string>()

  static Config: z<Partial<Config>, Config> = z.object({
    timeoutMs: z.natural().min(1).max(2_147_483_647).default(15_000),
    maxOutputBytes: z.natural().min(1).default(1024 * 1024),
    graceMs: z.natural().min(1).max(2_147_483_647).default(1_000),
    refreshIntervalMs: z.natural().min(1).max(2_147_483_647).default(3_000),
  })

  /**
   * @param ctx - Host services in the Session's execution world.
   * @param config - Validated process and observation bounds.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'workspaceGit')
  }

  /**
   * Observe the current checkout and local branches, including external Git changes.
   * @param session - Authorized live Session selecting the directory and sandbox policy.
   * @param signal - Remote subscription lifetime.
   * @returns Complete observations; a failed read closes the stream with a typed failure.
   */
  @Remote({ mode: 'stream' })
  async *follow(session: Session, signal: AbortSignal): AsyncIterable<GitBranchState> {
    while (!signal.aborted) {
      const state = await this.inspect(session, signal)
      yield state
      await new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timer)
          release()
          signal.removeEventListener('abort', done)
          resolve()
        }
        const timer = setTimeout(done, this.config.refreshIntervalMs)
        const release = this.ctx.on('workspace-git/changed', (root) => {
          if (state.kind === 'repository' && state.root === root) done()
        })
        signal.addEventListener('abort', done, { once: true })
        if (signal.aborted) done()
      })
    }
  }

  /**
   * Switch to one existing local branch using Git's normal file-conflict checks.
   * @param session - Authorized live Session selecting the directory and sandbox policy.
   * @param branch - Exact local branch name from the selector.
   * @param expected - Branch name, or detached commit id, shown when the user selected it.
   * @param signal - Caller lifetime; cancellation can leave a completed checkout and requires inspection.
   * @returns The verified checkout after Git exits successfully.
   * @throws A typed failure for active work, stale selection, Git refusal, or failed inspection; no automatic rollback runs.
   */
  @Remote
  async checkout(session: Session, branch: string, expected: string, signal: AbortSignal): Promise<GitBranchState> {
    const before = await this.inspect(session, signal)
    if (before.kind !== 'repository' || (before.current === null ? before.commit : before.current) !== expected) {
      throw new RemoteError('git-branch/stale', 'The checkout changed. Reload the branch list.', {})
    }
    if (!before.branches.some(item => item.name === branch)) {
      throw new RemoteError('git-branch/rejected', 'Select an existing local branch.', {})
    }
    if (branch === before.current) return before
    if (this.switching.has(before.root)) {
      throw new RemoteError('git-branch/busy', 'A branch switch is already in progress.', {})
    }
    this.switching.add(before.root)
    try {
      const { platform } = await this.ctx.subprocess.terminalEnvironment(signal)
      this.assertIdle(before.root, platform, session.id)
      const result = await this.run(session, before.root, [
        '-c', `core.hooksPath=${platform === 'windows' ? 'NUL' : '/dev/null'}`,
        'switch', '--no-guess', '--no-recurse-submodules', '--no-overwrite-ignore', '--', branch,
      ], signal)
      if (result.exitCode !== 0) {
        throw new RemoteError('git-branch/rejected', result.stderr.trim() || 'Git refused the branch switch.', {})
      }
      const after = await this.inspect(session, signal)
      // A successful switch can race an external Git client. Publish only the observed checkout.
      this.ctx.emit('workspace-git/changed', before.root)
      if (after.kind !== 'repository' || after.current !== branch) {
        throw new RemoteError('git-branch/stale', 'The checkout changed. Reload the branch list.', {})
      }
      return after
    } finally { this.switching.delete(before.root) }
  }

  private assertIdle(root: string, platform: 'posix' | 'windows', sessionId: SessionId): void {
    const paths = platform === 'windows' ? win32 : posix
    for (const agent of this.ctx.agents.list()) {
      const cwd = agent.session.header.cwd
      if (agent.status !== 'running') continue
      const path = cwd === undefined ? undefined : paths.relative(root, cwd)
      if (agent.id === sessionId || (path !== undefined
        && (path === '' || (!paths.isAbsolute(path) && path !== '..' && !path.startsWith(`..${paths.sep}`))))) {
        throw new RemoteError('git-branch/busy', 'Wait for running Sessions in this working tree to finish.', {})
      }
    }
  }

  private async inspect(session: Session, signal: AbortSignal): Promise<GitBranchState> {
    if (session.header.cwd === undefined) return { kind: 'unavailable' }
    const cwd = session.header.cwd
    const located = await this.run(session, cwd, ['rev-parse', '--show-toplevel'], signal)
    if (located.exitCode === 128 && /not a git repository/i.test(located.stderr)) return { kind: 'unavailable' }
    if (located.exitCode !== 0) throw new RemoteError('git-branch/read-failed', located.stderr.trim(), {})
    const root = located.stdout.replace(/\r?\n$/, '')
    const refs = await this.run(session, cwd, [
      'for-each-ref', '--format=%(refname:lstrip=2)%00%(HEAD)%00%(objectname:short)%00%(worktreepath)', 'refs/heads/',
    ], signal)
    if (refs.exitCode !== 0) throw new RemoteError('git-branch/read-failed', refs.stderr.trim(), {})
    const rows = refs.stdout.split('\n').filter(Boolean).map((line) => {
      const [name, head, oid, worktree] = line.split('\0')
      if (!name || head === undefined || oid === undefined || worktree === undefined) {
        throw new RemoteError('git-branch/read-failed', 'Git returned an incomplete branch entry.', {})
      }
      return { name, head, oid, worktree }
    })
    const active = rows.find(row => row.head === '*')
    let current = active?.name ?? null
    const commit = active?.oid ?? null
    const branches = rows.map(row => ({ name: row.name, occupied: row.head !== '*' && row.worktree !== '' }))
    if (current === null) {
      const symbolic = await this.run(session, cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], signal)
      if (symbolic.exitCode === 0) current = symbolic.stdout.trimEnd()
      else if (symbolic.exitCode === 1) {
        const detached = await this.run(session, cwd, ['rev-parse', '--short', 'HEAD'], signal)
        if (detached.exitCode !== 0) throw new RemoteError('git-branch/read-failed', detached.stderr.trim(), {})
        return { kind: 'repository', root, current: null, commit: detached.stdout.trimEnd(), branches }
      } else throw new RemoteError('git-branch/read-failed', symbolic.stderr.trim(), {})
    }
    return { kind: 'repository', root, current, commit, branches }
  }

  private async run(session: Session, cwd: string, args: readonly string[], signal: AbortSignal) {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)])
    const executable = await this.ctx.subprocess.resolveExecutable('git', undefined, deadline)
    const policy = this.ctx.sandboxPolicy.resolve({ session })
    const argv = [executable, ...args]
    const command = policy.mode === 'danger-full-access'
      ? argv : (await this.ctx.sandbox.confine(argv, { ...policy, mode: policy.mode }, deadline)).argv
    deadline.throwIfAborted()
    const child = this.ctx.subprocess.spawn({
      argv: command, cwd,
      env: { ...GIT_ENV, GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
      signal: deadline, graceMs: this.config.graceMs,
      stdio: { stdin: 'ignore', stdout: { maxBytes: this.config.maxOutputBytes }, stderr: { maxBytes: this.config.maxOutputBytes } },
    })
    try {
      const outcome = await child.done
      deadline.throwIfAborted()
      // Both streams use collect mode in the spawn request.
      const collected = child.collected as Required<SubprocessCollectedOutputs>
      const stdout = collected.stdout.readFrom(0)
      const stderr = collected.stderr.readFrom(0)
      if (stdout.lossy || stderr.lossy) {
        throw new RemoteError('git-branch/read-failed', 'Git output exceeded the configured limit.', {})
      }
      return { exitCode: outcome.exitCode, stdout: stdout.text, stderr: stderr.text }
    } finally {
      child.terminate()
      await child.waitForExit()
    }
  }
}
