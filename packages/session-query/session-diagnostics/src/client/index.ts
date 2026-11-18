/** Effect-owned diagnostics resources and the independent settings navigation entry. */
import type { Context } from '@deepseek-ai/cordis'
import z from 'zod'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type { DiagnosticFocus, DiagnosticList, DiagnosticQuery } from '../types.ts'
import { DiagnosticsPage, type DiagnosticsInjected } from './Page.tsx'
import { DiagnosticShortcut, type DiagnosticShortcutInjected } from './Shortcut.tsx'
import { en, zh, type DiagnosticUiKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Local failure history, index coverage and report preview copy. */
    sessionDiagnostics: DiagnosticUiKey
  }
  interface ResourceProtocolMap {
    /** Bounded authorized diagnostic groups for one explicit query. */
    'session-diagnostics': DiagnosticList
  }
}

const querySchema = z.object({
  scope: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('all') }),
    z.object({ kind: z.literal('cwd'), cwd: z.string() }),
    z.object({ kind: z.literal('session'), sessionId: z.string().transform(value => value as SessionId) }),
  ]).optional(),
  since: z.number().nonnegative().optional(), category: z.enum(['arguments', 'command', 'permission', 'tool', 'turn']).optional(),
  search: z.string().optional(),
})

/** Required browser services; this feature never opens or edits original logs directly. */
export const inject = ['slots', 'locale', 'resources', 'remote', 'remote.sessionDiagnostics', 'uiWorkspace']

/**
 * Register the settings page and optional settled-card action with their existing owners.
 * @param ctx - Browser context with generated Remote methods and framework-owned resources.
 */
export function apply(ctx: Context): void {
  const focus = createSnapshotStore<DiagnosticFocus | undefined>(undefined)
  const releaseFocus = (source: DiagnosticFocus | undefined): void => {
    if (focus.getSnapshot() === source) focus.set(undefined)
  }
  ctx.effect(() => ctx.locale.register('sessionDiagnostics', { en, zh }))
  ctx.effect(() => ctx.resources.register<'session-diagnostics'>({
    protocol: 'session-diagnostics',
    async *open(address, { signal }) {
      try {
        const url = new URL(address)
        const query: DiagnosticQuery = querySchema.parse(JSON.parse(url.searchParams.get('query') ?? '{}'))
        const result = url.searchParams.get('mode') === 'refresh'
          ? await ctx.remote.sessionDiagnostics.refresh(query, signal)
          : await ctx.remote.sessionDiagnostics.list(query, signal)
        signal.throwIfAborted()
        yield result
      } catch (error: unknown) {
        if (signal.aborted) return
        yield { ok: false as const, error: remoteErrorOf(error) ?? new RemoteError('gateway/internal', 'Diagnostics could not be loaded.', {}) }
      }
    },
  }))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'session-diagnostics', order: 80, locale: 'sessionDiagnostics',
    label: () => ctx.locale.bind('sessionDiagnostics')('nav'),
    inject: (): DiagnosticsInjected => ({
      openSession: (id) => { ctx.uiWorkspace.openSession(id) }, releaseFocus, hooks: { focus },
    }),
  }, DiagnosticsPage))
  ctx.inject(['settingsNavigation'], (navigationCtx) => {
    navigationCtx.slots.inject('tool.call.action', () => navigationCtx.slots.register({
      name: 'tool.call.action', id: 'session-diagnostics', locale: 'sessionDiagnostics',
      inject: (): DiagnosticShortcutInjected => ({ openDiagnostic: (source) => {
        const previous = focus.getSnapshot()
        focus.set(source)
        try { navigationCtx.settingsNavigation.openSection('session-diagnostics') }
        catch (error: unknown) { focus.set(previous); throw error }
      } }),
    }, DiagnosticShortcut))
  })
}
