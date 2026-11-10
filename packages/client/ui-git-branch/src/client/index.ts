/** Git resource provider, composer context registrations, and shell-owned operation feedback. */

import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createElement } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { GitBranchState } from '../types.ts'
import { BranchSelector, ComposerBranchSelector, type BranchInjected } from './BranchSelector.tsx'
import { en, zh, ja, es, fr, de, ru, pt, type GitBranchKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Git branch selector copy. */
    gitBranch: GitBranchKey
  }
  interface ResourceProtocolMap {
    /** Current checkout and local branches for one authorized live Session. */
    'git-branch': GitBranchState
  }
}

interface Notice {
  readonly seq: number
  readonly text: string
  readonly success: boolean
}

interface NoticeInjected {
  readonly hooks: { readonly branchNotice: ReturnType<typeof createSnapshotStore<Notice | null>> }
  readonly dismiss: () => void
}

function BranchNotice({ useBranchNotice, dismiss }: InjectFace<NoticeInjected>) {
  const notice = useBranchNotice(value => value)
  return notice === null ? null : createElement(Toast, { key: notice.seq, text: notice.text, ...notice.success ? { tone: 'success' as const } : {}, onDone: dismiss })
}

/** Required browser services for branch resources, presentation, and Remote calls. */
export const inject = ['slots', 'locale', 'resources', 'remote', 'remote.workspaceGit']

/**
   * Register the Git resource and composer selectors without changing conversation state.
 * @param ctx - Browser context with generated Remote calls and rendering services.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('gitBranch', { en, zh, ja, es, fr, de, ru, pt }))
  const t = ctx.locale.bind('gitBranch')
  const notice = createSnapshotStore<Notice | null>(null)
  let seq = 0
  ctx.effect(() => ctx.resources.register<'git-branch'>({
    protocol: 'git-branch',
    async *open(address, { signal }) {
      const sessionId = decodeURIComponent(new URL(address).pathname.slice(1)) as SessionId
      const stream = ctx.remote.$stream<GitBranchState>({
        name: `Git branches of ${sessionId}`,
        open: lifetime => ctx.remote.workspaceGit.follow(sessionId, lifetime),
        ended: () => new RemoteError('git-branch/read-failed', 'Git branch observation ended.', {}),
      })
      const abort = (): void => { void stream.dispose() }
      signal.addEventListener('abort', abort, { once: true })
      try {
        if (signal.aborted) return
        for await (const item of stream) {
          item.accept()
          yield { ok: true as const, value: item.value }
        }
      } catch (error) {
        if (!signal.aborted) yield { ok: false as const, error: remoteErrorOf(error) ?? new RemoteError('git-branch/read-failed', 'Could not observe Git branches.', {}) }
      } finally {
        signal.removeEventListener('abort', abort)
        await stream.dispose()
      }
    },
  }))
  const checkout: BranchInjected['checkout'] = async (sessionId, branch, expected) => {
    const result = await ctx.remote.workspaceGit.checkout(sessionId, branch, expected)
    if (result.ok) notice.set({ seq: ++seq, text: t('branch.switched', { branch }), success: true })
    else {
      const key = result.error.code === 'git-branch/busy' ? 'branch.busy'
        : result.error.code === 'git-branch/stale' ? 'branch.stale'
          : result.error.code === 'git-branch/rejected' ? 'branch.rejected' : 'branch.unknown'
      notice.set({ seq: ++seq, text: t(key), success: false })
    }
  }
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'git-branch', order: 30, locale: 'gitBranch',
    inject: (): BranchInjected => ({ checkout, compact: false }),
  }, ComposerBranchSelector))
  ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({
    name: 'conversation.hero.options', id: 'git-branch', locale: 'gitBranch',
    inject: (): BranchInjected => ({ checkout, compact: true }),
  }, BranchSelector))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'git-branch.notice', locale: 'gitBranch',
    inject: (): NoticeInjected => ({ hooks: { branchNotice: notice }, dismiss: () => { notice.set(null) } }),
  }, BranchNotice))
}
