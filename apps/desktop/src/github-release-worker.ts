/** Detached Node worker; waits for Electron exit and retains the previous app through launch handoff. */
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { parseGithubReleaseReplacement, recordGithubReleaseFailure, recordGithubReleaseHandoff, replaceGithubRelease, verifyGithubReleaseReplacement, waitForGithubReleaseExit } from './github-release-replacement.ts'

const execute = promisify(execFile)

async function launch(file: string, platform: 'darwin' | 'linux'): Promise<void> {
  if (platform === 'darwin') {
    await execute('/usr/bin/open', ['-n', file])
  } else {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(file, ['--updated'], { detached: true, stdio: 'ignore', env: { ...process.env, APPIMAGE: file } })
      child.once('error', reject)
      child.once('spawn', () => { child.unref(); resolve() })
    })
  }
}

async function main(): Promise<void> {
  const plan = parseGithubReleaseReplacement(JSON.parse(process.argv[2] ?? 'null'))
  await verifyGithubReleaseReplacement(plan)
  // Disconnect is a handoff signal; the PID check still requires actual Electron exit.
  const disconnected = new Promise<void>((resolve) => { process.once('disconnect', resolve) })
  process.send?.('ready')
  await disconnected
  let exited = false
  try {
    await waitForGithubReleaseExit(plan.parentPid, 60_000)
    exited = true
    await replaceGithubRelease(plan, async (file) => {
      await recordGithubReleaseHandoff(plan)
      await launch(file, plan.platform)
    })
  } catch (error) {
    console.error(error)
    try { await recordGithubReleaseFailure(plan, error) }
    catch (recordError) { console.error('Cannot retain the update failure', recordError) }
    // Failed restoration leaves the old entry in backup; never launch untrusted new bytes in that case.
    if (exited && !(error instanceof AggregateError)) await launch(plan.installed, plan.platform)
    process.exitCode = 1
  }
}

void main().catch((error: unknown) => { console.error(error); process.send?.('error'); process.exitCode = 1 })
