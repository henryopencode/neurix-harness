/** Stable failures surfaced by knowledge operations. */

import { HarnessError } from '@deepseek-ai/dsh-llm'

import type { KnowledgeErrorCode } from './types.ts'
export type { KnowledgeErrorCode } from './types.ts'

/** Expected knowledge failure; successful imports are published atomically. */
export class KnowledgeError extends HarnessError {
  override readonly code: KnowledgeErrorCode

  constructor(message: string, code: KnowledgeErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}
