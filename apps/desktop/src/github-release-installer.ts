/** Platform handoff for a main-process-owned, checksum-verified GitHub installer. */
import { spawn } from 'node:child_process'
import { app, shell } from 'electron'

/**
 * Start the Windows installer after task shutdown, or open a manual installation surface.
 * @param file - Verified installer in the application's private cache.
 * @param platform - Current platform; explicit in platform-independent handoff tests.
 * @returns After the installer starts or the system accepts the open request; rejects before quitting on spawn failure.
 */
export async function openGithubReleaseInstaller(file: string, platform: NodeJS.Platform): Promise<void> {
  if (platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' })
      child.once('error', reject)
      child.once('spawn', () => { child.unref(); resolve() })
    })
    app.quit()
  } else if (platform === 'darwin') {
    const error = await shell.openPath(file)
    if (error !== '') throw new Error(error)
  } else {
    shell.showItemInFolder(file)
  }
}
