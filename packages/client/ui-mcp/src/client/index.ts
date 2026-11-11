/** Sidebar registration, generated Remote calls, and live MCP resources. @module */
import type { Context } from '@deepseek-ai/cordis'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { McpManagerSnapshot } from '../types.ts'
import { McpPage, McpPanelIcon, type McpPageInjected } from './McpPage.tsx'
import { McpNotice, type McpNoticeValue } from './McpNotice.tsx'
import { en, zh, ja, es, fr, de, ru, pt, type McpLocaleKey } from './locales.ts'

export type { McpPageProps } from './McpPage.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP connection management and operation feedback. */
    mcpConfigManager: McpLocaleKey
  }
  interface ResourceProtocolMap {
    /** Current global MCP configuration and supervised connections. */
    mcp: McpManagerSnapshot
  }
}

/** Runtime services used by this page; the generated remote is mounted during activation. */
export const inject = ['slots', 'locale', 'remote', 'remote.mcpConfigManager', 'remoteAccess', 'resources']

/**
 * Add the MCP sidebar page and retain completed-operation notices after navigation.
 * @param ctx - running browser Client.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('mcpConfigManager', { en, zh, ja, es, fr, de, ru, pt }))
  const notice = createSnapshotStore<McpNoticeValue | null>(null)
  let seq = 0
  const failures: Record<string, McpLocaleKey> = {
    'mcp/conflict': 'conflict', 'mcp/duplicate': 'duplicate', 'mcp/invalid-config': 'invalidConfig',
    'mcp/overridden': 'overridden', 'mcp/reload-failed': 'reloadFailed', 'mcp/read-only': 'readOnly',
    'mcp/recovery-required': 'recoveryRequired', 'mcp/expression': 'expression',
    'gateway/internal': 'unknownOutcome', 'gateway/cancelled': 'unknownOutcome',
  }
  const perform = async (operation: () => Promise<RemoteResult<void>>, success: McpLocaleKey): Promise<boolean> => {
    try {
      const result = await operation()
      const key = result.ok ? success : failures[result.error.code] ?? 'failed'
      notice.set({ key, seq: ++seq, success: result.ok })
      return result.ok
    } catch (_transportError) {
      notice.set({ key: 'unknownOutcome', seq: ++seq, success: false })
      return false
    }
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'mcp-operation-notice', locale: 'mcpConfigManager',
    inject: () => ({ hooks: { notice }, dismiss: () => { notice.set(null) } }),
  }, McpNotice))
  ctx.inject(['remote.mcpConfigManager'], (owner) => {
    owner.effect(() => owner.resources.register<'mcp'>({
      protocol: 'mcp',
      async *open(_address, { signal }) {
        try {
          for await (const value of owner.remote.mcpConfigManager.watch(signal)) yield { ok: true as const, value }
        } catch (_remoteError) {
          if (!signal.aborted) yield { ok: false as const, error: new RemoteError('mcp/unavailable', 'Reopen MCP management to retry', {}) }
        }
      },
    }))
    const face: McpPageInjected = {
      save: (id, draft, revision) => perform(() => owner.remote.mcpConfigManager.save(id, draft, revision), 'saved'),
      remove: (id, revision) => perform(() => owner.remote.mcpConfigManager.removeServer(id, revision), 'removed'),
      setEnabled: (id, enabled, revision) => perform(() => owner.remote.mcpConfigManager.setEnabled(id, enabled, revision), enabled ? 'enabled' : 'stopped'),
      reconnect: id => perform(() => owner.remote.mcpConfigManager.reconnect(id), 'restarted'),
    }
    owner.remoteAccess.whenAccess('mcpConfigManager/list', function* () {
      yield owner.slots.inject('main', () => owner.slots.register({ name: 'main', key: 'mcp' as MainPanelId,
        locale: 'mcpConfigManager', inject: () => face }, McpPage))
      yield owner.slots.inject('sidebar.panellist', () => owner.slots.register({ name: 'sidebar.panellist', id: 'mcp',
        order: 5, locale: 'mcpConfigManager', label: () => owner.locale.bind('mcpConfigManager')('title') }, McpPanelIcon))
    })
  })
}
