/** Resource address shared by the two views of an Agent browser. @module */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComputerPreviewFrame } from '../types.ts'

/** Provider and sidebar tab kind for a live Agent browser. */
export const BROWSER_CAPTURE = 'agent-browser'

/** Prefix for Session-scoped browser resources. */
export const BROWSER_CAPTURE_PREFIX = `dsh-resource://${BROWSER_CAPTURE}/session/`

/** A captured frame and the aspect ratio used to display it. */
export interface BrowserCapture {
  readonly frame: ComputerPreviewFrame
  readonly aspect: number
  /** A timed out refresh left this document's last decoded image visible. */
  readonly failure?: 'CAPTURE_TIMEOUT'
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    /** The exact live browser target belonging to the addressed Session. */
    'agent-browser': BrowserCapture
  }
}

/**
 * Names the capture without depending on either view or its tab identity.
 * @param id - Session that owns the browser runtime.
 * @returns the resource address shared by both views.
 */
export function browserCaptureAddress(id: SessionId): string {
  return BROWSER_CAPTURE_PREFIX + encodeURIComponent(id)
}

/**
 * Accept only canonical addresses so one Session has one polling resource.
 * @param address - candidate resource address.
 * @returns the owning Session for a canonical address, if any.
 */
export function browserCaptureSession(address: string): SessionId | undefined {
  if (!address.startsWith(BROWSER_CAPTURE_PREFIX)) return undefined
  const suffix = address.slice(BROWSER_CAPTURE_PREFIX.length)
  if (suffix === '') return undefined
  try {
    const id = decodeURIComponent(suffix) as SessionId
    return browserCaptureAddress(id) === address ? id : undefined
  } catch (_malformedEncoding) { return undefined }
}
