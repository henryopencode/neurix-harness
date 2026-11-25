/** Bound and record native activity only after an external activation is accepted. */
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentActivity, SubagentActivityEvent } from './activity-types.ts'
import type { SubagentResult } from './types.ts'

const TEXT_LIMIT = 16_384
const UPDATE_LIMIT = 64

function preview(text: string): string {
  return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…` : text
}

type Update = SubagentActivity | { readonly kind: 'truncated' }

/** One accepted execution owns its record and each startup observation before publication. */
export class ExternalActivity {
  private childId: SessionId | undefined
  private updates = 0
  private closed = false
  private readonly pending: Update[] = []

  constructor(
    private readonly session: Session,
    private readonly product: string,
    private readonly label: string,
    private readonly prompt: string,
    private readonly cwd: string,
    private readonly warn: (error: unknown) => void,
  ) {}

  /**
   * Record one observation or hold it until publication. The first dropped update logs a marker.
   * @param item - public product output or the name of an observed tool.
   */
  readonly report = (item: SubagentActivity): void => {
    if (this.closed || this.updates > UPDATE_LIMIT) return
    const update = this.updates++ === UPDATE_LIMIT
      ? { kind: 'truncated' } as const
      : item.kind === 'message' ? { kind: item.kind, text: preview(item.text) } : { kind: item.kind, name: preview(item.name) }
    if (this.childId === undefined) this.pending.push(update)
    else this.record({ childId: this.childId, ...update })
  }

  /**
   * Publish the accepted run and any observations received while it was starting.
   * @param childId - the same identity as the parent-owned catalog entry.
   */
  start(childId: SessionId): void {
    this.childId = childId
    this.record({ childId, kind: 'started', product: this.product, label: preview(this.label), prompt: preview(this.prompt), cwd: this.cwd })
    for (const update of this.pending) this.record({ childId, ...update })
    this.pending.length = 0
  }

  /**
   * Stop accepting progress and record the terminal outcome if startup committed.
   * @param result - the managed activation's final outcome after teardown.
   */
  finish(result: SubagentResult): void {
    this.closed = true
    const childId = this.childId
    this.pending.length = 0
    if (childId === undefined) return
    this.record({
      childId, kind: 'finished',
      status: result.stopReason === 'completed' ? 'completed' : result.stopReason === 'aborted' ? 'aborted' : 'failed',
      text: preview(result.output.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')),
      ...result.diagnostic === undefined ? {} : { diagnostic: result.diagnostic },
    })
  }

  private record(data: SubagentActivityEvent): void {
    if (this.closed && data.kind !== 'finished') return
    try {
      this.session.append('subagent/activity', data, { ignorable: true })
    } catch (error: unknown) {
      // The display record may be incomplete. Settlement still owns the execution and parent notice.
      this.closed = true
      this.warn(error)
    }
  }
}
