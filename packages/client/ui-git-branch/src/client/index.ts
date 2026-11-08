/** Registers the Git resource and the conversation-header branch badge. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import contribution from '@deepseek-ai/dsh-client-ui-git-branch/remote'
import { branchProvider } from './provider.ts'
import { GitBranchBadge } from './GitBranchBadge.tsx'
import { dictionaries } from './locales.ts'

/** Required browser services and the generated Git Remote namespace. */
export const inject = ['slots', 'locale', 'resources', 'remote']

/**
 * Mount the branch badge before the native opening button.
 * @param ctx - Client context with Session resources and header slots.
 * @returns teardown that closes UI subscriptions before withdrawing its Remote methods.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.gitBranch'], (scope) => {
    scope.effect(() => scope.locale.register('git-branch', dictionaries))
    const provider = branchProvider(scope.remote)
    scope.effect(() => {
      const release = scope.resources.register(provider)
      return async () => { release(); await provider.settle() }
    })
    scope.slots.inject('conversation.session.header.utilities', () => scope.slots.register({
      name: 'conversation.session.header.utilities', id: 'git-branch', order: -20, locale: 'git-branch',
    }, GitBranchBadge))
  })
  try { await ui } catch (error) { await ui.dispose(); await unmountRemote(); throw error }
  return async () => { await ui.dispose(); await unmountRemote() }
}
