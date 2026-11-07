/**
 * ModelDirectoryResolver (`ctx.modelDirectories`): the root owner of per-session
 * {@link ModelDirectory} instances. Both selection entries (the /model popup
 * and the composer model seat) resolve their session's directory through
 * this service, which is what makes the dual entry one shared state.
 *
 * Per-session storage follows the client service pattern (InputTriggerService /
 * CommandUiRuntime): a lazy service-internal map whose entry is deleted by the
 * owning scope's disposer. The host `dsh-scope` ScopedLayers registry does
 * does not belong here: it derives scope from the host carrier mechanism
 * (object-keyed), while client scopes tag contexts with branded SessionId
 * strings, and it models global+shadow named registries — this is a
 * per-session singleton with no global layer to merge.
 */
import type {} from '@deepseek-ai/dsh-client-product-analytics/client'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WeakMapWithValues } from '@deepseek-ai/dsh-util-values'
import { ModelCatalogDirectory } from './catalog.ts'
import { ModelDirectory } from './directory.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

declare module '@deepseek-ai/cordis' {
  interface Context {
    modelDirectories: ModelDirectoryResolver
  }
}

/** Live mutable state in one holder (service methods run behind the caller-ctx tracker). */
interface LiveState {
  /** Directories keyed by Client binding, removed by their scope disposer. */
  readonly directories: WeakMapWithValues<SessionBinding, ModelDirectory>
}

/** The `ctx.modelDirectories` session model-selection service. */
export class ModelDirectoryResolver extends Service {
  static inject = ['sessions', 'remote', 'remote.session']

  private readonly live: LiveState = { directories: new WeakMapWithValues() }
  private readonly catalog: ModelCatalogDirectory
  private readonly selectionLocks = new Set<{ readonly locked: (sessionId: SessionId) => boolean }>()
  private readonly lockRevision = createSnapshotStore(0)

  /**
   * Share the configured model catalog with settings and other model pickers.
   * @returns The same observable catalog read by Session selectors.
   */
  catalogSource(): ModelCatalogDirectory['store'] { return this.catalog.store }

  /** Refresh every model picker after an explicit retry. */
  refreshCatalog(): void { this.catalog.refresh() }

  /**
   * Read whether a feature currently owns a Session's model route.
   * @param sessionId - Current conversation identity; no binding is created.
   * @returns Whether the model route is locked.
   */
  selectionLocked(sessionId: SessionId): boolean {
    return [...this.selectionLocks].some(provider => provider.locked(sessionId))
  }

  /**
   * Contribute a reversible model-choice lock while preserving effort controls.
   * @param provider - Session predicate and invalidation subscription owned by the caller.
   * @returns Disposer withdrawing this lock and its subscription.
   */
  lockSelection(provider: {
    locked: (sessionId: SessionId) => boolean
    subscribe: (listener: () => void) => () => void
  }): () => Promise<void> {
    return this.ctx.effect(() => {
      const notify = (): void => { this.lockRevision.set(this.lockRevision.getSnapshot() + 1) }
      const entry = { locked: provider.locked }
      const off = provider.subscribe(notify)
      this.selectionLocks.add(entry)
      notify()
      return () => {
        if (!this.selectionLocks.delete(entry)) return
        off(); notify()
      }
    }, 'model directories: selection lock')
  }

  /**
   * @param ctx - owning root context (the service registers itself as `models`).
   */
  constructor(ctx: Context) {
    super(ctx, 'modelDirectories')
    this.catalog = new ModelCatalogDirectory(ctx)
    void this.catalog.load().catch(() => { /* selectors expose the shared error */ })
    ctx.on('connection/reset', () => {
      this.catalog.resetGeneration()
      for (const directory of this.live.directories.values) directory.resetConnected()
    })
    ctx.remote.$on('llm/adapters-updated', () => { this.catalog.refresh() })
    ctx.remote.$on('settings/document-updated', () => { this.catalog.refresh() })
    ctx.remote.$on('credentials/record-updated', () => { this.catalog.refresh() })
    ctx.remote.$on('credentials/reference-updated', () => { this.catalog.refresh() })
  }

  /**
   * Resolve the per-session shared directory (lazy; the scope disposer
   * removes and disposes it). Unknown sessions fail loud.
   * @param sessionId - the owning session.
   * @returns the resident directory both entries share.
   */
  directoryFor(sessionId: SessionId): ModelDirectory {
    const { live } = this
    const sessions = this.ctx.sessions
    const actx = sessions.scope(sessionId)
    if (actx === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no scope`)
    const binding = sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no binding`)
    const existing = live.directories.get(binding)
    if (existing !== undefined) return existing
    const directory = new ModelDirectory(
      this.ctx.remote.session,
      sessionId,
      () => sessions.subagentAddress(sessionId) === undefined,
      this.catalog,
      binding.session.projections.faceOf('modelSelection'),
      () => binding.session.getSnapshot().blank,
      (name, attributes) => this.ctx.get('productAnalytics')?.track(name, attributes),
      {
        getSnapshot: () => this.selectionLocked(sessionId),
        subscribe: (listener) => {
          let previous = this.selectionLocked(sessionId)
          return this.lockRevision.subscribe(() => {
            const next = this.selectionLocked(sessionId)
            if (next !== previous) { previous = next; listener() }
          })
        },
      },
    )
    live.directories.set(binding, directory)
    actx.effect(() => () => {
      directory.dispose()
      live.directories.delete(binding)
    }, 'ui-model-selection: session directory')
    return directory
  }
}
