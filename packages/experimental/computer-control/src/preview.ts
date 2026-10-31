/** Session-owned display-only capture registration and authenticated preview access. @module */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ComputerPreviewSnapshot } from './preview-types.ts'
import { ComputerPreviewSources } from '@deepseek-ai/dsh-client-ui-computer-preview'
export { ComputerPreviewSources } from '@deepseek-ai/dsh-client-ui-computer-preview'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Display-only computer capture Remote. */
    computerPreview: ComputerPreviewController
  }
}

/** Read-only Remote for images from the currently selected Session's target. */
export class ComputerPreviewController extends TypertRemoteService {
  static inject = ['typert']

  /**
   * @param ctx - context with the authenticated Remote registry.
   * @param options - captured sources and validated refresh setting.
   */
  constructor(ctx: Context, private readonly options: {
    sources: ComputerPreviewSources
    refreshMs: (active: boolean, idle: boolean) => number
  }) {
    super(ctx, 'computerPreview', { namespace: 'computerPreview' })
  }

  /**
   * Capture only the existing target; never send mouse or keyboard input.
   * @param sessionId - displayed Session identity.
   * @param signal - browser cancellation or Remote withdrawal.
   * @returns a bounded preview and the Host-owned refresh interval.
   */
  @Remote
  async frame(sessionId: SessionId, signal: AbortSignal): Promise<ComputerPreviewSnapshot> {
    const frame = await this.options.sources.capture(sessionId, signal)
    return { frame, refreshMs: this.options.refreshMs(frame.kind === 'frame' && frame.active, frame.kind === 'idle') }
  }
}
