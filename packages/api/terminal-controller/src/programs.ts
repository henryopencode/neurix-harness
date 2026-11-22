/** Terminal programs resolve in the same execution environment that starts their PTY. */
import type { SubprocessRuntime, SubprocessTerminalEnvironment } from '@deepseek-ai/dsh-subprocess'
import type { TerminalProgramId, TerminalProgramLaunch, TerminalProgramStatus, TerminalShell } from './types.ts'

/** Trusted launch choices from a Host profile. */
export interface TerminalProgram {
  /** Unique program identifier used in launch requests. */
  readonly id: TerminalProgramId
  /** Tool name displayed in settings and terminal tabs. */
  readonly name: string
  /** Executable name or path resolved in the terminal's execution environment. */
  readonly command: string
  /** Arguments for starting a new tool session. */
  readonly args: readonly string[]
  /** Arguments for choosing a previous tool session; omission disables resume. */
  readonly resumeArgs?: readonly string[] | null | undefined
  /** HTTPS installation guide offered if the executable is missing. */
  readonly guideUrl?: string | null | undefined
}

async function executable(
  subprocess: SubprocessRuntime, platform: SubprocessTerminalEnvironment['platform'], program: TerminalProgram, signal: AbortSignal,
): Promise<string | undefined> {
  // ConPTY starts a native executable directly. Do not pass a package-manager script through a shell.
  const command = platform === 'windows' && !/\.exe$/iu.test(program.command) ? program.command + '.exe' : program.command
  try {
    return await subprocess.resolveExecutable(command, undefined, signal)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'SubprocessExecutableNotFoundError') return undefined
    throw error
  }
}

/**
 * Check configured executables without running them or reading credentials.
 * @param subprocess - Host or Session subprocess provider.
 * @param programs - configured launch choices.
 * @param signal - caller cancellation.
 * @returns availability in display order; provider failures reject the query.
 */
export async function discoverPrograms(
  subprocess: SubprocessRuntime, programs: readonly TerminalProgram[], signal: AbortSignal,
): Promise<TerminalProgramStatus[]> {
  if (programs.length === 0) return []
  const { platform } = await subprocess.terminalEnvironment(signal)
  return Promise.all(programs.map(async program => ({
    id: program.id, name: program.name, installed: await executable(subprocess, platform, program, signal) !== undefined,
    canResume: program.resumeArgs != null,
    ...program.guideUrl == null ? {} : { guideUrl: program.guideUrl },
  })))
}

/**
 * Resolve one configured program again at allocation time.
 * @param subprocess - Session subprocess provider.
 * @param programs - configured launch choices.
 * @param launch - selected program and action.
 * @param signal - allocation cancellation.
 * @returns the executable and intended arguments, or undefined if the selection is unavailable.
 */
export async function resolveProgram(
  subprocess: SubprocessRuntime, programs: readonly TerminalProgram[], launch: TerminalProgramLaunch, signal: AbortSignal,
): Promise<TerminalShell | undefined> {
  const program = programs.find(candidate => candidate.id === launch.id)
  if (program === undefined) return undefined
  const args = launch.mode === 'start' ? program.args : program.resumeArgs
  if (args == null) return undefined
  const { platform } = await subprocess.terminalEnvironment(signal)
  const path = await executable(subprocess, platform, program, signal)
  return path === undefined ? undefined : { path, name: program.name, args }
}
