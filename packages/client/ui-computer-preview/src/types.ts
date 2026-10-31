/** Display-only captures shared by preview sources and the Client. @module */

import type { SessionId } from '@deepseek-ai/dsh-session'

/** Independent cursor position relative to the captured window. */
export interface ComputerPreviewCursor {
  /** Horizontal fraction of the window width. */
  x: number
  /** Vertical fraction of the window height. */
  y: number
  /** Start of a content-free click pulse, in epoch milliseconds. */
  clickAt?: number
  /** Whether the independent pointer is holding a button for a drag. */
  pressed?: boolean
}

/** A complete display-only preview; capture failure preserves tool resources. */
export type ComputerPreviewFrame =
  | { kind: 'idle' }
  | { kind: 'unavailable'; title: string; code: 'CAPTURE_FAILED' | 'IMAGE_TOO_LARGE' | 'PERMISSION_REQUIRED' | 'CAPTURE_TIMEOUT' }
  | {
    kind: 'frame'
    title: string
    imageUrl: string
    action: string
    active: boolean
    capturedAt: number
    cursor?: ComputerPreviewCursor
    keyboard?: { kind: 'typing'; key?: string } | { kind: 'shortcut'; keys: readonly string[] }
    scroll?: 'up' | 'down' | 'left' | 'right'
  }

/**
 * One exact live Agent's display-only capture.
 * @param signal - reader cancellation; rejects after owned work settles.
 * @returns the target image, idle state, or explicit capture failure.
 */
export type ComputerPreviewCapture = (signal: AbortSignal) => Promise<ComputerPreviewFrame>

/**
 * Observer supplied by a preview carrier that owns its capture subscriptions.
 * @param sessionId - exact live Session owning this capture.
 * @param capture - read-only capture function.
 * @returns withdrawal that cancels and joins accepted captures.
 */
export type RegisterComputerPreview = (sessionId: SessionId, capture: ComputerPreviewCapture) => () => Promise<void>

/** Image and pacing read by the preview UI without adding Session events. */
export interface ComputerPreviewSnapshot {
  /** Latest target capture or its explicit availability. */
  frame: ComputerPreviewFrame
  /** Minimum delay before another UI capture. */
  refreshMs: number
}
