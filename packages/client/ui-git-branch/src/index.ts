/** Session-authorized, read-only Git HEAD observations for the conversation header. */
import { setTimeout } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceFileScope } from '@deepseek-ai/dsh-api-workspace-files'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { readHead } from './head.ts'
import type { GitHead } from './types.ts'

export type { GitHead } from './types.ts'

/** Deployment bounds for live branch observations. */
export interface Config {
  /** Maximum duration of one Git observation, in milliseconds. */
  readonly timeoutMs: number
  /** Delay between observations while the header is subscribed, in milliseconds. */
  readonly refreshMs: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Session-scoped Git HEAD Remote owner. */
    gitBranch: GitBranch
  }
}

/** Live repository metadata; the existing workspace lookup authorizes each Session. */
export default class GitBranch extends TypertRemoteService {
  static inject = ['typert', 'subprocess', 'workspaceFiles']

  static Config: z<Config> = z.object({
    timeoutMs: z.number().step(1).min(1).max(60_000).default(5000),
    refreshMs: z.number().step(1).min(1).max(60_000).default(5000),
  })

  /** @param ctx - Host subprocess and Session lookup services. @param config - validated observation bounds. */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'gitBranch')
  }

  /**
   * Observe HEAD immediately and publish later branch changes without modifying the repository.
   * @param workspaceFileScope - authorized Session directory, resolved by the Host.
   * @param signal - caller lifetime; closes the pending command or refresh delay.
   * @returns current and changed HEAD values; missing Git is reported as unavailable.
   */
  @Remote({ mode: 'stream' })
  async *follow(workspaceFileScope: WorkspaceFileScope, signal: AbortSignal): AsyncIterable<GitHead> {
    const isAborted = (): boolean => signal.aborted
    let executable: string
    try {
      executable = await this.ctx.subprocess.resolveExecutable('git', undefined, signal)
    } catch (_error) {
      signal.throwIfAborted()
      yield { kind: 'unavailable' }
      return
    }
    if (!await gitExecutableReady(this.ctx.subprocess, executable, this.config.timeoutMs, signal)) {
      yield { kind: 'unavailable' }
      return
    }
    let previous: string | undefined
    while (!isAborted()) {
      const head = await readHead(this.ctx.subprocess, executable, workspaceFileScope.workspaceRoot, this.config.timeoutMs, signal)
      const key = JSON.stringify(head)
      if (key !== previous) {
        previous = key
        yield head
      }
      try {
        await setTimeout(this.config.refreshMs, undefined, { signal })
      } catch (error) {
        if (isAborted()) return
        throw error
      }
    }
  }
}

/** Apple's Git launcher needs selected developer tools; the execution provider may run on another OS. */
async function gitExecutableReady(
  subprocess: SubprocessRuntime, executable: string, timeoutMs: number, signal: AbortSignal,
): Promise<boolean> {
  if (executable !== '/usr/bin/git') return true
  let selector: string
  try {
    selector = await subprocess.resolveExecutable('xcode-select', undefined, signal)
  } catch (_error) {
    signal.throwIfAborted()
    return true
  }
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
  const child = subprocess.spawn({
    argv: [selector, '-p'], cwd: '/', signal: bounded, graceMs: 1000,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
  })
  const outcome = await child.done
  bounded.throwIfAborted()
  return outcome.exitCode === 0
}
