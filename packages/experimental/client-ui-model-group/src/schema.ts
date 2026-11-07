/**
 * Browser-safe validation of configured model members.
 * @module
 */
import { z } from 'zod'
import type { ModelGroupMember } from './types.ts'

/**
 * Exact route, immutable alias, and user-authored model strengths.
 */
export const memberSchema: z.ZodType<ModelGroupMember> = z.object({
  name: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/), label: z.string().min(1),
  provider: z.string().min(1), model: z.string().min(1), strengths: z.string(),
}).strict()
