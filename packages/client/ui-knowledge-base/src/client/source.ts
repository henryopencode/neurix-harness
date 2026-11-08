/** Management intent and mutation ownership; fetched values stay in the shared resource model. */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { Document, KnowledgeApi, KnowledgePageInjected, Notice, Translate, ViewState } from './types.ts'

type MutationApi = {
  [Key in 'upload' | 'deleteDocument']: (...args: Parameters<KnowledgeApi[Key]>) => ReturnType<KnowledgeApi[Key]>
}

/** Private UI commands and their activation-owned state, without duplicated resource data. */
export interface KnowledgeSource extends Omit<KnowledgePageInjected, 'hooks'> {
  readonly view: SnapshotStore<ViewState>
  readonly notice: SnapshotStore<Notice | null>
  readonly revision: SnapshotStore<number>
  /** Dismiss the currently displayed operation outcome. */
  readonly dismiss: () => void
  /** Stop mutation admission, abort pending requests, and await their settlement. */
  readonly close: () => Promise<void>
}

/**
 * Own UI commands, cancellable mutations, and refresh notifications for one plugin activation.
 * @param api - Generated knowledge management methods.
 * @param t - Current-locale translation function.
 * @returns Observable intent and outcomes, mutation commands, and quiescent disposal.
 */
export function createKnowledgeSource(api: MutationApi, t: Translate): KnowledgeSource {
  const view = createSnapshotStore<ViewState>({ workspaceId: null, query: '', offset: 0, busy: null })
  const notice = createSnapshotStore<Notice | null>(null)
  const revision = createSnapshotStore(0)
  const lifetime = new AbortController()
  const pending = new Set<Promise<unknown>>()
  let sequence = 0
  const refresh = (): void => { revision.set(revision.getSnapshot() + 1) }
  const report = (text: string, success = false): void => {
    if (!lifetime.signal.aborted) notice.set({ sequence: ++sequence, text, success })
  }
  async function operation<T>(kind: 'import' | 'remove', fallback: T, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (lifetime.signal.aborted || view.getSnapshot().busy !== null) return fallback
    view.set({ ...view.getSnapshot(), busy: kind })
    const promise = run(lifetime.signal)
    pending.add(promise)
    try { return await promise } catch (_error) {
      report(t('actionFailed'))
      return fallback
    } finally {
      pending.delete(promise)
      view.set({ ...view.getSnapshot(), busy: null })
    }
  }
  return {
    view, notice, revision,
    selectWorkspace(this: void, workspaceId: WorkspaceId | null): void {
      view.set({ ...view.getSnapshot(), workspaceId, query: '', offset: 0 })
    },
    search(this: void, query: string): void { view.set({ ...view.getSnapshot(), query: query.trim(), offset: 0 }) },
    page(this: void, offset: number): void { view.set({ ...view.getSnapshot(), offset }) },
    refresh,
    report: (text: string): void => { report(text) },
    dismiss: (): void => { notice.set(null) },
    upload(this: void, workspaceId: WorkspaceId, name: string, base64: string, replace: boolean): Promise<'done' | 'exists' | 'failed'> {
      return operation<'done' | 'exists' | 'failed'>('import', 'failed', async (signal) => {
        const result = await api.upload(workspaceId, name, base64, replace, signal)
        if (result.ok) {
          refresh()
          report(t('importSuccess', { name }), true)
          return 'done'
        }
        if (result.error.code === 'knowledge/operation-failed' && result.error.details.reason === 'KNOWLEDGE_ALREADY_EXISTS') return 'exists'
        report(t(result.error.code === 'knowledge/operation-failed' && result.error.details.reason === 'KNOWLEDGE_UNSUPPORTED'
          ? 'unsupported' : 'actionFailed'))
        return 'failed'
      })
    },
    remove(this: void, workspaceId: WorkspaceId, document: Document): Promise<boolean> {
      return operation('remove', false, async (signal) => {
        const result = await api.deleteDocument(workspaceId, document.documentId, signal)
        if (!result.ok) { report(t('actionFailed')); return false }
        refresh()
        report(t('removeSuccess', { name: document.title }), true)
        return true
      })
    },
    async close(this: void): Promise<void> {
      lifetime.abort()
      await Promise.allSettled(pending)
    },
  }
}

/**
 * Wait for a coalesced local invalidation without timers or polling.
 * @param revision - Refresh source owned by the active management feature.
 * @param seen - Last consumed revision.
 * @param signal - Shared resource lifetime.
 * @returns True for a newer revision, or false when the resource closes.
 */
export async function waitForRefresh(
  revision: ReturnType<typeof createKnowledgeSource>['revision'], seen: number, signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return false
  if (revision.getSnapshot() !== seen) return true
  await new Promise<void>((resolve) => {
    const finish = (): void => { unsubscribe(); signal.removeEventListener('abort', finish); resolve() }
    const unsubscribe = revision.subscribe(finish)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted || revision.getSnapshot() !== seen) finish()
  })
  try { signal.throwIfAborted() } catch (_aborted) { return false }
  return true
}
