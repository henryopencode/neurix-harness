/** Session-authorized, read-only Git HEAD observations for the conversation header. */
import { setTimeout } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceFileScope } from '@deepseek-ai/dsh-api-workspace-files'
import type {} from '@deepseek-ai/dsh-subprocess'
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
    let executable: string
    try {
      executable = await this.ctx.subprocess.resolveExecutable('git', undefined, signal)
    } catch (_error) {
      signal.throwIfAborted()
      yield { kind: 'unavailable' }
      return
    }
    let previous: string | undefined
    while (!signal.aborted) {
      const head = await readHead(this.ctx.subprocess, executable, workspaceFileScope.workspaceRoot, this.config.timeoutMs, signal)
      const key = JSON.stringify(head)
      if (key !== previous) {
        previous = key
        yield head
      }
      try {
        await setTimeout(this.config.refreshMs, undefined, { signal })
      } catch (error) {
        if (signal.aborted) return
        throw error
      }
    }
  }
}
