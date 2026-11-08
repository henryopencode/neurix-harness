/** Bounded, read-only Git commands over the composed subprocess provider. */
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { GitHead } from './types.ts'

/**
 * Read HEAD without refreshing the index or running repository hooks.
 * @param subprocess - execution provider serving the Session's filesystem.
 * @param executable - resolved Git executable.
 * @param cwd - the Host-resolved Session directory.
 * @param timeoutMs - total deadline for this observation.
 * @param signal - subscription cancellation.
 * @returns the branch, detached commit, or a directory outside a working tree.
 * @throws when Git fails, times out, or exceeds the metadata output limit.
 */
export async function readHead(
  subprocess: SubprocessRuntime, executable: string, cwd: string, timeoutMs: number, signal: AbortSignal,
): Promise<GitHead> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
  const run = async (args: readonly string[]) => {
    const child = subprocess.spawn({
      argv: [executable, ...args], cwd, signal: bounded, graceMs: 1000,
      env: {
        GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_COMMON_DIR: undefined,
        GIT_INDEX_FILE: undefined, GIT_OBJECT_DIRECTORY: undefined, GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
        GIT_CONFIG_COUNT: '0', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C',
      },
      stdio: { stdin: 'ignore', stdout: { maxBytes: 16 * 1024 }, stderr: { maxBytes: 16 * 1024 } },
    })
    const outcome = await child.done
    bounded.throwIfAborted()
    const { stdout: output, stderr: errors } = child.collected
    if (output === undefined || errors === undefined) throw new Error('Git subprocess did not expose its requested output readers')
    const stdout = output.readFrom(0)
    if (stdout.lossy) throw new RemoteError('git-branch/read-failed', 'Git HEAD metadata exceeded the output limit', {})
    return { exitCode: outcome.exitCode, text: stdout.text.trim(), error: errors.readFrom(0).text }
  }
  const repository = await run(['rev-parse', '--is-inside-work-tree'])
  if (repository.exitCode !== 0) {
    if (repository.error.includes('not a git repository')) return { kind: 'not-repository' }
    throw new RemoteError('git-branch/read-failed', repository.error.trim() || 'Could not locate the Git repository', {})
  }
  if (repository.text === 'false') return { kind: 'not-repository' }
  const branch = await run(['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (branch.exitCode === 0 && branch.text !== '') return { kind: 'branch', name: branch.text }
  if (branch.exitCode !== 1) throw new RemoteError('git-branch/read-failed', branch.error.trim() || 'Could not read the Git branch', {})
  const commit = await run(['rev-parse', '--short', 'HEAD'])
  if (commit.exitCode !== 0 || !/^[0-9a-f]+$/u.test(commit.text)) {
    throw new RemoteError('git-branch/read-failed', commit.error.trim() || 'Could not read detached HEAD', {})
  }
  return { kind: 'detached', commit: commit.text }
}
