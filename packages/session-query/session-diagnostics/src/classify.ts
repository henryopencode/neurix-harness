/** Shared structured tool-failure classification for the index and optional transcript shortcut. */
import z from 'zod'
import type { DiagnosticCategory } from './types.ts'

const shellSchema = z.object({ shellOutcome: z.object({
  kind: z.literal('foreground'), exitCode: z.number().nullable(), signal: z.string().nullable(),
  timedOut: z.boolean(), aborted: z.boolean(), timeoutMs: z.number(), stopped: z.string().optional(),
  sandbox: z.object({
    mode: z.string(), denied: z.boolean(), enforcement: z.string().optional(), runnerFailed: z.boolean().optional(),
  }).optional(),
}) })

/** Durable native or nested Tool result facts; metadata is validated before interpretation. */
export interface DiagnosticToolOutcome {
  isError?: boolean | undefined
  error?: { code: string } | undefined
  meta?: unknown
}

/**
 * Classify settled failures without parsing rendered output or counting expected cancellations.
 * @param outcome - Persisted Tool result flags, identity and optional shell metadata.
 * @returns Failure category and code, or undefined for success and expected user cancellation.
 */
export function diagnosticToolFailure(outcome: DiagnosticToolOutcome): { category: DiagnosticCategory; code: string } | undefined {
  const parsed = shellSchema.safeParse(outcome.meta)
  const shell = parsed.success ? parsed.data.shellOutcome : undefined
  const code = outcome.error?.code
  if (shell?.aborted === true || shell?.stopped === 'user' || code === 'ABORTED' || code === 'ABORTED_BEFORE_DISPATCH') return undefined
  const permission = shell?.sandbox?.denied === true
  const command = shell !== undefined
    && (shell.timedOut || shell.signal !== null || shell.exitCode !== 0 || shell.sandbox?.runnerFailed === true)
  if (!outcome.isError && !command && !permission) return undefined
  return {
    category: permission ? 'permission' : command ? 'command' : code === 'INVALID_ARGS' ? 'arguments' : 'tool',
    code: code ?? (permission ? 'SANDBOX_DENIED' : shell === undefined ? 'TOOL_ERROR' : shell.timedOut ? 'COMMAND_TIMEOUT' : shell.sandbox?.runnerFailed ? 'SANDBOX_RUNNER_FAILED' : shell.signal !== null ? `SIGNAL_${shell.signal}` : `EXIT_${shell.exitCode ?? 'UNKNOWN'}`),
  }
}
