/** Shared task labels and state markers for the canvas, list, and inspector. */
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkflowTaskStatus } from './canvas-contract.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { assertNever } from '@deepseek-ai/dsh-util-values'

/**
 * Give historical empty member labels an accessible task name.
 * @param content - recorded task label.
 * @param t - canvas dictionary.
 * @returns the original label or the localized unnamed-task label.
 */
export function taskTitle(content: string, t: TranslateNS<'workflowCanvas'>): string {
  return content === '' ? t('task.untitled') : content
}

/**
 * Preserve an empty phase's identity while giving its controls a visible label.
 * @param phase - exact recorded phase name.
 * @param t - canvas dictionary.
 * @returns the original phase name or its localized empty-name label.
 */
export function phaseTitle(phase: string, t: TranslateNS<'workflowCanvas'>): string {
  return phase === '' ? t('phase.empty') : phase
}

/**
 * Map a recorded or planned task state to the existing status marker.
 * @param status - visible task status.
 * @returns the shared primitive's corresponding state.
 */
export function taskDot(status: WorkflowTaskStatus): StateDotState {
  switch (status) {
    case 'running': return 'ongoing'
    case 'completed': return 'done'
    case 'failed': return 'error'
    case 'blocked':
    case 'cancelled':
    case 'interrupted': return 'warning'
    case 'pending':
    case 'waiting':
    case 'removed': return 'idle'
    /* v8 ignore next -- Every member of the closed task-status union is handled. */
    default: return assertNever(status)
  }
}
