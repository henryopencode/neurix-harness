/** Sidebar entry, resource protocols, and reversible management bindings. */

import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { RemoteError, type RemoteResult, type TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-knowledge-base/remote'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { loadDashboard } from './dashboard.ts'
import { KnowledgePage } from './Page.tsx'
import { KnowledgeNotice } from './Notice.tsx'
import { KnowledgeIcon } from './icon.tsx'
import { createKnowledgeSource, waitForRefresh } from './source.ts'
import { de, en, es, fr, ja, pt, ru, zh, NS } from './locales.ts'
import type { Dashboard, KnowledgePageInjected } from './types.ts'

/** Client services consumed directly by this built-in management feature. */
export const inject = ['remote', 'remoteAccess', 'slots', 'locale', 'resources', 'workspaces']

function unavailable(signal: AbortSignal): RemoteResult<never> | undefined {
  return signal.aborted ? undefined : { ok: false, error: new RemoteError('gateway/internal', 'Knowledge is unavailable.', {}) }
}

/**
 * Mount the generated API before exposing the sidebar entry and management page.
 * @param ctx - Browser services carrying Remote, resources, locale, and workspace state.
 * @param contribution - Generated Host knowledge Remote descriptors.
 * @returns A disposer that closes UI/resource consumers before unmounting the Remote methods.
 */
export async function mountKnowledgeUi(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  ctx.effect(() => ctx.locale.register(NS, { en, zh, ja, es, fr, de, ru, pt }))
  const unmount = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.knowledge'], (owner) => {
    const source = createKnowledgeSource(owner.remote.knowledge, owner.locale.bind(NS))
    owner.effect(() => () => source.close())
    owner.effect(() => owner.workspaces.list.subscribe(source.refresh))
    owner.on('connection/reset', source.refresh)
    owner.effect(() => owner.resources.register<'knowledge-dashboard'>({
      protocol: 'knowledge-dashboard',
      async *open(address, { signal }) {
        const url = new URL(address)
        const scope = decodeURIComponent(url.pathname.slice(1))
        const workspaceId = scope === 'all' ? null : brandString<WorkspaceId>(scope)
        const query = url.searchParams.get('query') ?? ''
        const offset = Number(url.searchParams.get('offset') ?? 0)
        let seen = -1
        while (await waitForRefresh(source.revision, seen, signal)) {
          seen = source.revision.getSnapshot()
          try {
            const result = await loadDashboard(
              owner.remote.knowledge.dashboard, owner.workspaces.list.getSnapshot().items, workspaceId, query, offset, signal,
            )
            signal.throwIfAborted()
            if (!result.ok) console.error('Knowledge dashboard request failed', result.error.code, result.error.message)
            yield result
          } catch (_error) {
            const failure = unavailable(signal)
            if (failure === undefined) return
            yield failure
          }
        }
      },
    }))
    owner.effect(() => owner.resources.register<'knowledge-passage'>({
      protocol: 'knowledge-passage',
      async *open(address, { signal }) {
        const url = new URL(address)
        const parts = url.pathname.slice(1).split('/')
        const workspaceId = brandString<WorkspaceId>(decodeURIComponent(parts[0] ?? ''))
        const documentId = brandString<Dashboard['documents'][number]['documentId']>(decodeURIComponent(parts[1] ?? ''))
        let seen = -1
        while (await waitForRefresh(source.revision, seen, signal)) {
          seen = source.revision.getSnapshot()
          try {
            const result = await owner.remote.knowledge.read(
              workspaceId, documentId, Number(url.searchParams.get('chunk') ?? 0), url.searchParams.get('version') ?? '', signal,
            )
            signal.throwIfAborted()
            yield result
          } catch (_error) {
            const failure = unavailable(signal)
            if (failure === undefined) return
            yield failure
          }
        }
      },
    }))
    owner.slots.inject('shell.overlay', () => owner.slots.register({
      name: 'shell.overlay', id: 'knowledge-notice', locale: NS,
      inject: () => ({ hooks: { notice: source.notice }, dismiss: source.dismiss }),
    }, KnowledgeNotice))
    owner.remoteAccess.whenAccess('knowledge/dashboard', function* () {
      yield owner.slots.inject('main', () => owner.slots.register({
        name: 'main', key: 'knowledge-base', locale: NS,
        inject: (): KnowledgePageInjected => ({
          hooks: { view: source.view, workspaces: owner.workspaces.list },
          selectWorkspace: source.selectWorkspace, search: source.search, page: source.page, refresh: source.refresh,
          upload: source.upload, remove: source.remove, report: source.report,
        }),
      }, KnowledgePage))
      yield owner.slots.inject('sidebar.panellist', () => owner.slots.register({
        name: 'sidebar.panellist', id: 'knowledge-base', order: 6.5, locale: NS,
        label: () => owner.locale.bind(NS)('title'),
      }, KnowledgeIcon))
    })
  })
  try { await ui } catch (error) { await ui.dispose(); await unmount(); throw error }
  return async () => { await ui.dispose(); await unmount() }
}
