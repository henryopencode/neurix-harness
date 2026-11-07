/**
 * Stable model-group failures for commands, model tools, and hosts.
 * @module
 */
import { HarnessError } from '@deepseek-ai/dsh-llm'
/**
 * Expected model-group failure categories.
 */
export type ModelGroupErrorCode = 'GROUP_UNAUTHORIZED' | 'GROUP_DISABLED' | 'GROUP_STOPPED' | 'GROUP_MODEL_UNAVAILABLE' | 'GROUP_MODEL_BUSY' | 'GROUP_CAPACITY' | 'GROUP_INVALID_CONFIG' | 'GROUP_PARTIAL_DELIVERY' | 'GROUP_SELF_ASSIGNMENT'

/**
 * An expected rejection; failure does not imply rollback of already accepted model work.
 */
export class ModelGroupError extends HarnessError {
  /**
   * @param code - Stable handling category.
   * @param message - Actionable diagnostic.
   */
  constructor(override readonly code: ModelGroupErrorCode, message: string) { super(message, code); this.name = 'ModelGroupError' }
}
