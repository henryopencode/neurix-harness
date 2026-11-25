/** User-visible observations of a native subagent in the parent conversation. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Selected work visible in the native agent's public output. */
export type SubagentActivity =
  | { readonly kind: 'message'; readonly text: string }
  | { readonly kind: 'tool'; readonly name: string }

/** Bounded, display-only record. The parent model receives the ordinary settlement notice. */
export type SubagentActivityEvent = { readonly childId: SessionId } & (
  | { readonly kind: 'started'; readonly product: string; readonly label: string; readonly prompt: string; readonly cwd: string }
  | SubagentActivity
  | { readonly kind: 'truncated' }
  | { readonly kind: 'finished'; readonly status: 'completed' | 'aborted' | 'failed'; readonly text: string; readonly diagnostic?: string }
)

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Optional display-only native subagent activity paired by child id.
     * @param data - parent-owned invocation, progress, or settlement detail.
     */
    'subagent/activity': SubagentActivityEvent
  }
}
