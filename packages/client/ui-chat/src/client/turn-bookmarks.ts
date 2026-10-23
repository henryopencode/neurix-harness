/** Browser-local Turn bookmarks, isolated by Session and published after saving. */
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Bookmark operation reported by the frame-wide notification host. */
export type TurnBookmarkNoticeKind = 'saved' | 'removed' | 'readFailed' | 'saveFailed'

/** One transient bookmark outcome. */
export interface TurnBookmarkNotice {
  readonly kind: TurnBookmarkNoticeKind
  readonly seq: number
}

/** Session-local bookmark source and its durable mutation. */
export interface TurnBookmarkSource extends ObservableSnapshot<readonly number[]> {
  /**
   * Save a bookmark choice before publishing it; failures retain the current marks.
   * @param turn - positive Turn number from the navigation outline.
   * @param bookmarked - whether to keep the bookmark.
   */
  setBookmarked(turn: number, bookmarked: boolean): void
}

/**
 * Read and validate saved Turn numbers without replacing unreadable data.
 * @param key - Session-specific browser storage key.
 * @returns saved Turn numbers, or an empty list when no bookmarks exist.
 */
function readBookmarks(key: string): readonly number[] {
  const raw = localStorage.getItem(key)
  if (raw === null) return []
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value) || !value.every((turn: unknown) => (
    typeof turn === 'number' && Number.isSafeInteger(turn) && turn > 0
  ))) throw new Error('Invalid saved Turn bookmarks')
  return [...new Set<number>(value)].sort((a, b) => a - b)
}

/**
 * Create one Session's bookmark source for the Chat registration's lifetime.
 * @param sessionId - Session owning the bookmarks.
 * @param notify - reports success or a storage failure outside the Chat panel.
 * @returns stable observable and save action; browser storage failures leave it usable for reading.
 */
export function createTurnBookmarkSource(
  sessionId: SessionId,
  notify: (kind: TurnBookmarkNoticeKind) => void,
): TurnBookmarkSource {
  const key = `dsh.chat.turn-bookmarks.v1.${sessionId}`
  const source = createSnapshotStore<readonly number[]>([])
  try {
    source.set(readBookmarks(key))
  } catch (_error: unknown) {
    // Unreadable bookmarks remain on disk; a later action retries the read.
    notify('readFailed')
  }
  return {
    getSnapshot: () => source.getSnapshot(),
    subscribe: listener => source.subscribe(listener),
    setBookmarked(turn, bookmarked) {
      let saved: readonly number[]
      try {
        saved = readBookmarks(key)
      } catch (_error: unknown) {
        // Do not overwrite saved bookmarks when their current value is unknown.
        notify('readFailed')
        return
      }
      const next = new Set(saved)
      if (bookmarked) next.add(turn)
      else next.delete(turn)
      const turns = [...next].sort((a, b) => a - b)
      try {
        localStorage.setItem(key, JSON.stringify(turns))
      } catch (_error: unknown) {
        // The visible bookmark state changes only after the write succeeds.
        notify('saveFailed')
        return
      }
      source.set(turns)
      notify(bookmarked ? 'saved' : 'removed')
    },
  }
}
