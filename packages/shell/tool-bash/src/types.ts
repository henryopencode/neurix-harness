/**
 * Durable Bash result metadata for local presenters and diagnostics.
 * @module @deepseek-ai/dsh-tool-bash
 */

/**
 * Final foreground execution facts, independent of rendered output. A timeout
 * can coexist with exit code zero; a sandbox denial need not produce a nonzero
 * exit. User-requested stops are identified by `stopped`, not by the signal.
 */
export type BashForegroundOutcome = {
  /** Identifies a finalized foreground result, including preparation expiry. */
  kind: 'foreground'
  /** Exit code, or null when no exit code was reported. */
  exitCode: number | null
  /** Terminating signal, or null when no signal was reported. */
  signal: string | null
  /** Whether the execution deadline expired before caller cancellation. */
  timedOut: boolean
  /** Whether caller cancellation was the first cause of termination. */
  aborted: boolean
  /** Effective execution or foreground-wait timeout in milliseconds. */
  timeoutMs: number
  /** Outside stop reason, present when the job registry stopped the command. */
  stopped?: string
  /** Executor-reported sandbox facts; absence supplies no confinement facts. */
  sandbox?: {
    /** Serialized mode actually applied to the command. */
    mode: string
    /** Whether the sandbox denied a file operation. */
    denied: boolean
    /** Serialized enforcement level reported by the executor. */
    enforcement?: string
    /** Whether the sandbox runner failed before the command could run. */
    runnerFailed?: boolean
  }
}

/**
 * Bash's tool-private `tool/result` and `tool/ptc-dispatch` metadata. Background
 * starts and promoted running commands contain only `cwd`; thrown tool failures
 * do not pass through the successful-output metadata projection. Older results
 * may also omit `shellOutcome` and provide no structured execution facts.
 */
export type BashOutcomeMeta = {
  /** Resolved directory supplied to the shell executor. */
  cwd: string
  /** Final execution facts, present only for a settled foreground result. */
  shellOutcome?: BashForegroundOutcome
}
