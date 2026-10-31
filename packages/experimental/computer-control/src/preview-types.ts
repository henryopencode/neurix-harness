/** Display-only picture-in-picture records shared by Host and Client. @module */

import type { ComputerPreviewFrame } from '@deepseek-ai/dsh-client-ui-computer-preview/types'

/** Image and pacing read by the preview UI without adding Session events. */
export interface ComputerPreviewSnapshot {
  /** Latest target capture or its explicit availability. */
  frame: ComputerPreviewFrame
  /** Minimum delay before another UI capture. */
  refreshMs: number
}
