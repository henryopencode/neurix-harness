/**
 * Pure types of the todo domain: the ONE home of the `todos` projection-key
 * declaration plus its payload types, free of this package's host-side value
 * imports (dsh-tools, zod). Two namespace projections serve it — `./types`
 * for host consumers, `./client/types` (the browser half-entry's re-export)
 * for client aggregates — with zero content duplication.
 *
 * @module @deepseek-ai/dsh-tool-todo/types
 */

import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Stable identity of one planned task across whole-list replacements. */
export type TodoId = Branded<'TodoId'>

/**
 * One entry in an agent's todo list — the unit of the `todo/write`
 * whole-list snapshot declared by this package.
 *
 * Content and status support compact checklists. Optional planning fields
 * describe explicit dependencies, execution ownership, and deliverables;
 * omitted dependencies never imply an ordering between list entries.
 */
export interface TodoItem {
  /** What this task is — a short imperative line shown in the UI. */
  content: string
  /** Lifecycle state. `in_progress` marks a task being worked now; parallel work may mark several. */
  status: 'pending' | 'in_progress' | 'completed'
  /** Stable task identity, preserved when its title or status changes. */
  id?: TodoId
  /** Display grouping only; phases impose no execution order. */
  phase?: string
  /** Work to perform and relevant input materials. */
  description?: string
  /** Observable deliverable or acceptance criterion for this task. */
  expectedOutput?: string
  /** Identities of tasks whose results this task needs. */
  dependsOn?: TodoId[]
  /** Reason a pending task cannot proceed, including a requested human decision. */
  blockedReason?: string
  /** Published child Session performing this task; execution events remain authoritative. */
  sessionId?: SessionId
  /** Concise recorded result or verification evidence. */
  result?: string
  /** Output file paths, resolved relative to the owning Session's working directory. */
  artifacts?: string[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole-list snapshot; latest write wins on replay. Log-only UI state; never derived history. */
    'todo/write': {
      todos: TodoItem[]
      /** Owning turn, when the writer has observed its start; absent in historical records. */
      turn?: number
    }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * The agent's current whole todo list (the latest `todo/write` snapshot),
     * or `null` before the first write. Whole-value rule: every `todo/write`
     * carries the complete replacement list, so the fold is last-wins.
     * Excluded from Session summary payloads, with `null` kept outside the
     * exclusion mark so the pre-first-write value stays expressible.
     */
    todos: SessionProjectionSummaryExcluded<TodoItem[]> | null
  }
}
