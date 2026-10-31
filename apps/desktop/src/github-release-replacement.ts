/** Same-filesystem application replacement after the Electron process has exited. */
import { access, lstat, rename, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'

/** Private worker instructions; paths are produced by the main process, never the renderer. */
export interface GithubReleaseReplacement {
  readonly platform: 'darwin' | 'linux'
  readonly parentPid: number
  readonly installed: string
  readonly prepared: string
  readonly backup: string
  readonly resultFile: string
  readonly version: string
}

/**
 * Validate instructions crossing into the detached installer process.
 * @param value - Parsed worker argument.
 * @returns Instructions restricted to one sibling staging directory and a distinct installed path.
 */
export function parseGithubReleaseReplacement(value: unknown): GithubReleaseReplacement {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid replacement instructions')
  const plan = value as Record<string, unknown>
  if ((plan.platform !== 'darwin' && plan.platform !== 'linux')
    || typeof plan.parentPid !== 'number' || !Number.isSafeInteger(plan.parentPid) || plan.parentPid <= 0
    || typeof plan.version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(plan.version)) throw new Error('Invalid replacement target')
  for (const key of ['installed', 'prepared', 'backup', 'resultFile'] as const) {
    if (typeof plan[key] !== 'string' || !isAbsolute(plan[key]) || plan[key].includes('\0') || resolve(plan[key]) !== plan[key]) throw new Error(`Invalid replacement ${key}`)
  }
  const { installed, prepared, backup, resultFile } = plan as Record<'installed' | 'prepared' | 'backup' | 'resultFile', string>
  if (dirname(prepared) !== dirname(backup) || dirname(dirname(prepared)) !== dirname(installed)
    || prepared === backup || installed === prepared || installed === backup) throw new Error('Replacement must use a separate sibling staging directory')
  return { platform: plan.platform, parentPid: plan.parentPid, installed, prepared, backup, resultFile, version: plan.version }
}

/**
 * Reject unwritable installations and incomplete staging before allowing Electron to quit.
 * @param plan - Main-process-owned application paths.
 * @returns Once both application entries and their parent can participate in a rename.
 */
export async function verifyGithubReleaseReplacement(plan: GithubReleaseReplacement): Promise<void> {
  const installed = await lstat(plan.installed), prepared = await lstat(plan.prepared)
  if (installed.isSymbolicLink() || prepared.isSymbolicLink()
    || (plan.platform === 'darwin' ? !installed.isDirectory() || !prepared.isDirectory() : !installed.isFile() || !prepared.isFile())) {
    throw new Error('The application and replacement must be real application entries')
  }
  await access(dirname(plan.installed), constants.W_OK)
  try { await lstat(plan.backup) }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  throw new Error('The replacement backup already exists')
}

/**
 * Wait for actual process exit before touching application files.
 * @param pid - Electron process that owns the current application.
 * @param timeoutMs - Maximum permitted shutdown time.
 * @returns When no process owns that PID; permission failures and timeouts reject.
 */
export async function waitForGithubReleaseExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs
  while (true) {
    try { process.kill(pid, 0) }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return
      throw error
    }
    if (performance.now() >= deadline) throw new Error('The application did not exit; its files were left unchanged')
    await setTimeout(Math.min(100, Math.max(1, deadline - performance.now())))
  }
}

/**
 * Replace and launch the app, restoring the previous entry when promotion or launch fails.
 * @param plan - Verified same-filesystem entries; the original process must already have exited.
 * @param launch - Platform launcher, resolving only after the operating system accepts the launch.
 * @returns After handoff; rejection leaves the original restored or reports both replacement and restoration failures.
 */
export async function replaceGithubRelease(plan: GithubReleaseReplacement, launch: (file: string) => Promise<void>): Promise<void> {
  await verifyGithubReleaseReplacement(plan)
  await rename(plan.installed, plan.backup)
  let promoted = false
  try {
    await rename(plan.prepared, plan.installed)
    promoted = true
    await launch(plan.installed)
  } catch (error) {
    try {
      if (promoted) await rename(plan.installed, plan.prepared)
      await rename(plan.backup, plan.installed)
    } catch (restoreError) {
      throw new AggregateError([error, restoreError], `Application restoration failed; the previous application remains at ${plan.backup}`)
    }
    throw error
  }
}

/**
 * Atomically retain an install failure for the next application launch.
 * @param plan - Private main-process result destination and expected version.
 * @param error - Failure retained as technical details beside the localized update summary.
 * @returns After the complete result is committed; failures remain visible in the worker log.
 */
export async function recordGithubReleaseFailure(plan: GithubReleaseReplacement, error: unknown): Promise<void> {
  await recordResult(plan, { status: 'error', version: plan.version, message: String(error) })
}

/**
 * Retain the old application until the replacement finishes its first Host startup.
 * @param plan - Replacement version and staging directory containing the backup.
 * @returns Once the next application launch can acknowledge the handoff and remove the backup.
 */
export async function recordGithubReleaseHandoff(plan: GithubReleaseReplacement): Promise<void> {
  await recordResult(plan, { status: 'handoff', version: plan.version, staging: dirname(plan.prepared), installed: plan.installed })
}

async function recordResult(plan: GithubReleaseReplacement, result: object): Promise<void> {
  const temporary = join(dirname(plan.resultFile), `install-result-${randomUUID()}.tmp`)
  await writeFile(temporary, JSON.stringify(result) + '\n', { mode: 0o600, flag: 'wx' })
  await rename(temporary, plan.resultFile)
}
