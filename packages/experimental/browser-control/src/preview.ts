/** Authenticated read-only access to browser-owned display captures. @module */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ComputerPreviewSources } from '@deepseek-ai/dsh-experimental-computer-preview'
import type { BrowserPreviewSnapshot } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Display-only capture of this Session's isolated browser. */
    browserPreview: BrowserPreviewController
  }
}

/** Read-only Remote with a namespace independent of application control. */
export class BrowserPreviewController extends TypertRemoteService {
  static inject = ['typert']

  /** @param ctx - authenticated Remote registry. @param options - browser-owned captures and pacing. */
  constructor(ctx: Context, private readonly options: {
    sources: ComputerPreviewSources
    refreshMs: (active: boolean, idle: boolean) => number
  }) { super(ctx, 'browserPreview', { namespace: 'browserPreview' }) }

  /**
   * Capture an existing browser target without starting an Agent or sending input.
   * @param sessionId - Session displayed by the Client.
   * @param signal - viewing and Remote lifetime.
   * @returns bounded image and Host-selected refresh interval.
   */
  @Remote
  async frame(sessionId: SessionId, signal: AbortSignal): Promise<BrowserPreviewSnapshot> {
    const frame = await this.options.sources.capture(sessionId, signal)
    return { frame, refreshMs: this.options.refreshMs(frame.kind === 'frame' && frame.active, frame.kind === 'idle') }
  }
}
