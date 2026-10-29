/** Display-only isolated-browser records shared by Host and Client. @module */
import type { ComputerPreviewFrame } from '@deepseek-ai/dsh-experimental-computer-use-unified/types'

/** Browser image and pacing independent of model-visible screenshots. */
export interface BrowserPreviewSnapshot {
  /** Latest owned tab image or explicit availability. */
  frame: ComputerPreviewFrame
  /** Minimum delay before the next display-only capture. */
  refreshMs: number
}
