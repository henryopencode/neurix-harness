/** Stable failures for image generation and result acquisition. @module */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Failure classes retained in normalized tool results. */
export type ImageGenerationErrorCode =
  | 'IMAGE_GENERATION_INVALID_CONFIG'
  | 'IMAGE_GENERATION_INVALID_REQUEST'
  | 'IMAGE_GENERATION_PROVIDER_ERROR'
  | 'IMAGE_GENERATION_INVALID_RESPONSE'
  | 'IMAGE_GENERATION_LIMIT_EXCEEDED'
  | 'IMAGE_GENERATION_STORAGE_FAILED'

/** Expected image-generation failure; no automatic retry is safe after a paid request starts. */
export class ImageGenerationError extends HarnessError {
  declare readonly code: ImageGenerationErrorCode

  /**
   * @param message - operation, consequence, and safe next action without secrets or response bodies.
   * @param code - stable failure class.
   * @param options - original failure retained for diagnostics.
   */
  // oxlint-disable-next-line no-useless-constructor -- Restricts construction to image-generation failure codes.
  constructor(message: string, code: ImageGenerationErrorCode, options?: ErrorOptions) {
    super(message, code, options)
  }
}
