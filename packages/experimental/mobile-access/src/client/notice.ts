/** Connection-operation notices shared with the shell overlay. @module */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MobileAccessOutcome } from './MobileAccessRow.tsx'

/** Completed connection actions remain visible after leaving the plugin page. */
export class ConnectionNotice {
  /** Latest completed action, or null after its notice is dismissed. */
  readonly source = createSnapshotStore<{ outcome: MobileAccessOutcome; seq: number } | null>(null)
  private seq = 0

  /**
   * Publish one completed action's localized notice identity.
   * @param outcome - operation result, never a secret or network error body.
   */
  report(outcome: MobileAccessOutcome): void { this.source.set({ outcome, seq: ++this.seq }) }

  /** Remove the current notice after its display lifetime. */
  dismiss(): void { this.source.set(null) }
}
