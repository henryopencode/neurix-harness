/** Shared preview rendering service for independent application and browser sources. @module */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComputerPreviewSnapshot } from '../types.ts'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ComputerPreview } from './ComputerPreview.tsx'

/** One display-only source registered by its owning UI plugin. */
export interface PreviewSource {
  /** Source identity selects localized labels and the initial panel position. */
  surface: 'applications' | 'browser'
  /**
   * @param sessionId - displayed Session.
   * @param signal - preview viewing lifetime.
   * @returns existing target pixels without starting a runtime or sending input.
   */
  loadPreview: (sessionId: SessionId, signal: AbortSignal) => Promise<ComputerPreviewSnapshot>
}

/** UI-only service shared through Cordis injection. */
export interface ComputerPreviewUi {
  /**
   * Add one independent source to the existing conversation header.
   * @param ctx - source owner's lifetime and slot context.
   * @param source - exact capture callback and presentation identity.
   * @returns quiescent withdrawal of the source's header contribution.
   */
  register(ctx: Context, source: PreviewSource): () => Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Shared picture-in-picture renderer; sources keep independent ownership. */
    computerPreviewUi: ComputerPreviewUi
  }
}

/**
 * Create a renderer without starting capture or registering a source.
 * @returns source-registration service owned by the caller's client plugin.
 */
export function createPreviewUi(): ComputerPreviewUi {
  return { register(ctx, source) {
    const fiber = ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
      name: 'conversation.session.header.utilities', id: `${source.surface}-control.preview`, locale: 'computerPreview',
      inject: () => source,
    }, ComputerPreview))
    return () => { fiber(); return Promise.resolve() }
  } }
}
