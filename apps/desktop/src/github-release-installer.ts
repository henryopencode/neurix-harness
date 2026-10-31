/** Platform handoff for a main-process-owned, checksum-verified GitHub installer. */
import { execFile, spawn } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { app, shell } from 'electron'
import { verifyGithubReleaseReplacement, type GithubReleaseReplacement } from './github-release-replacement.ts'
import type { DesktopUpdateState } from './ipc.ts'

const execute = promisify(execFile)

async function plist(file: string, key: string): Promise<string> {
  return (await execute('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', file])).stdout.trim()
}

/**
 * Prepare a verified application beside its installed entry without replacing the running app.
 * @param file - Main-process-owned, checksum-verified DMG or AppImage.
 * @param platform - Supported POSIX installation format.
 * @param version - Checked stable version that the disk image must contain.
 * @param work - Private worker directory that owns the temporary disk-image mount.
 * @returns Verified replacement instructions; preparation failures remove the staged application.
 */
export async function stageGithubReleaseReplacement(file: string, platform: 'darwin' | 'linux', version: string, work: string): Promise<GithubReleaseReplacement> {
  const installed = platform === 'darwin' ? resolve(app.getAppPath(), '../../..') : await realpath(process.env.APPIMAGE ?? '')
  const staging = await mkdtemp(join(dirname(installed), '.neurix-update-'))
  const prepared = join(staging, platform === 'darwin' ? 'Neurix Harness.app' : 'Neurix Harness.AppImage')
  try {
    if (platform === 'darwin') {
      const mount = join(work, 'volume')
      await mkdir(mount)
      await execute('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, file], { timeout: 120_000 })
      try {
        const apps = (await readdir(mount, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name.endsWith('.app'))
        if (apps.length !== 1 || apps[0] === undefined) throw new Error('The disk image must contain exactly one application')
        const source = join(mount, apps[0].name)
        const info = join(source, 'Contents/Info.plist')
        if (await plist(info, 'CFBundleShortVersionString') !== version
          || await plist(info, 'CFBundleIdentifier') !== await plist(join(installed, 'Contents/Info.plist'), 'CFBundleIdentifier')) {
          throw new Error('The disk image application does not match this update')
        }
        await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', source], { timeout: 120_000 })
        await execute('/usr/bin/ditto', [source, prepared], { timeout: 300_000 })
        await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', prepared], { timeout: 120_000 })
      } finally { await execute('/usr/bin/hdiutil', ['detach', mount], { timeout: 30_000 }) }
    } else {
      await copyFile(file, prepared, constants.COPYFILE_EXCL)
      await chmod(prepared, 0o755)
    }
    const plan: GithubReleaseReplacement = { platform, parentPid: process.pid, installed, prepared,
      backup: join(staging, 'previous'), version, resultFile: join(dirname(file), 'install-result.json') }
    await verifyGithubReleaseReplacement(plan)
    return plan
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

async function handoffReplacement(file: string, platform: 'darwin' | 'linux', version: string): Promise<void> {
  const work = await mkdtemp(join(dirname(file), '.installer-'))
  const worker = join(work, 'worker.mjs')
  await writeFile(worker, await readFile(join(app.getAppPath(), 'lib/github-release-worker.js')), { flag: 'wx', mode: 0o600 })
  const plan = await stageGithubReleaseReplacement(file, platform, version, work)
  const log = await open(join(dirname(file), 'installer.log'), 'a', 0o600)
  const node = join(process.resourcesPath, 'runtime/primary-runtime/dependencies/node/bin/node')
  const child = spawn(node, [worker, JSON.stringify(plan)], { detached: true, stdio: ['ignore', log.fd, log.fd, 'ipc'] })
  const closed = new Promise<void>((resolveClosed) => { child.once('close', () => { resolveClosed() }) })
  try {
    // The ready message proves Node and the standalone worker are loaded before their app is moved.
    await new Promise<void>((resolveReady, reject) => {
      const timeout = setTimeout(() => { reject(new Error('The update installer did not become ready')) }, 30_000)
      child.once('error', (error) => { clearTimeout(timeout); reject(error) })
      child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`The update installer exited before handoff (${code})`)) })
      child.once('message', (message: unknown) => {
        if (message !== 'ready') { clearTimeout(timeout); reject(new Error('The update installer rejected its instructions')); return }
        clearTimeout(timeout)
        resolveReady()
      })
    })
    await log.close()
    child.unref()
    child.disconnect()
    app.quit()
  } catch (error) {
    child.kill()
    await closed
    await rm(dirname(plan.prepared), { recursive: true, force: true })
    throw error
  } finally { await log.close() }
}

/**
 * Acknowledge a completed Host startup or recover an installer's failure through the update UI.
 * @param directory - Private GitHub update cache.
 * @param currentVersion - Running application version, checked before releasing the previous application.
 * @returns A retryable installation report, or undefined when there is no recorded failure.
 */
export async function readGithubReleaseInstallationFailure(
  directory: string, currentVersion: string,
): Promise<DesktopUpdateState | undefined> {
  const file = join(directory, 'install-result.json')
  let text: string
  try { text = await readFile(file, 'utf8') }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || !('version' in value) || typeof value.version !== 'string'
    || !('status' in value)) throw new Error('Invalid recorded installation result')
  if (value.status === 'handoff') {
    if (!('staging' in value) || typeof value.staging !== 'string' || !('installed' in value) || typeof value.installed !== 'string'
      || dirname(value.staging) !== dirname(value.installed) || !basename(value.staging).startsWith('.neurix-update-')
      || resolve(value.staging) !== value.staging) throw new Error('Invalid recorded application backup')
    const installed = process.platform === 'darwin' ? resolve(app.getAppPath(), '../../..') : await realpath(process.env.APPIMAGE ?? '')
    if (value.installed !== installed) throw new Error('The recorded backup belongs to another application installation')
    if (currentVersion !== value.version) return { phase: 'error', failedOperation: 'install', version: value.version,
      message: `Expected ${value.version} after installation, but ${currentVersion} started; the previous application is retained in ${value.staging}` }
    await rm(value.staging, { recursive: true, force: true })
    await rm(file)
    return undefined
  }
  if (value.status !== 'error' || !('message' in value) || typeof value.message !== 'string') throw new Error('Invalid recorded installation failure')
  await rm(file)
  return { phase: 'error', failedOperation: 'install', version: value.version, message: value.message }
}

/**
 * Start the Windows installer or stage a POSIX replacement after confirmed task shutdown.
 * @param file - Verified installer in the application's private cache.
 * @param platform - Current platform; explicit in platform-independent handoff tests.
 * @param version - Checked stable version; required for packaged POSIX replacement, omitted for manual development handoff.
 * @returns After the installer starts or the system accepts the open request; rejects before quitting on spawn failure.
 */
export async function openGithubReleaseInstaller(file: string, platform: NodeJS.Platform, version?: string): Promise<void> {
  if (platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' })
      child.once('error', reject)
      child.once('spawn', () => { child.unref(); resolve() })
    })
    app.quit()
  } else if (app.isPackaged && version !== undefined && (platform === 'darwin' || (platform === 'linux' && process.env.APPIMAGE !== undefined))) {
    await handoffReplacement(file, platform, version)
  } else if (platform === 'darwin') {
    const error = await shell.openPath(file)
    if (error !== '') throw new Error(error)
  } else {
    shell.showItemInFolder(file)
  }
}
