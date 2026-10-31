/** Installer argument and quit ordering without executing a downloaded binary. */
import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it, vi } from 'vitest'
import { openGithubReleaseInstaller, readGithubReleaseInstallationFailure, stageGithubReleaseReplacement } from '../src/github-release-installer.ts'

const native = vi.hoisted(() => ({ quit: vi.fn(), getAppPath: vi.fn<() => string>(), openPath: vi.fn(async (_file: string) => ''), showItemInFolder: vi.fn(), spawn: vi.fn() }))
vi.mock('electron', () => ({ app: { quit: native.quit, getAppPath: native.getAppPath }, shell: { openPath: native.openPath, showItemInFolder: native.showItemInFolder } }))
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: native.spawn }))
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

it('waits for Windows installer creation before quitting and requests relaunch through NSIS', async () => {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
  native.spawn.mockReturnValueOnce(child)
  const operation = openGithubReleaseInstaller('C:\\private cache\\update.exe', 'win32')
  expect(native.quit).not.toHaveBeenCalled()
  expect(native.spawn).toHaveBeenCalledWith('C:\\private cache\\update.exe', ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' })
  child.emit('spawn')
  await operation
  expect(child.unref).toHaveBeenCalledOnce()
  expect(native.quit).toHaveBeenCalledOnce()
})

it('keeps the app running if Windows cannot create the installer process', async () => {
  const child = new EventEmitter()
  native.spawn.mockReturnValueOnce(child)
  const operation = openGithubReleaseInstaller('update.exe', 'win32')
  child.emit('error', new Error('access denied'))
  await expect(operation).rejects.toThrow('access denied')
  expect(native.quit).not.toHaveBeenCalled()
})

it('opens a macOS disk image and reports system-open failures without quitting', async () => {
  await openGithubReleaseInstaller('/cache/update.dmg', 'darwin')
  expect(native.openPath).toHaveBeenCalledWith('/cache/update.dmg')
  native.openPath.mockResolvedValueOnce('Cannot open disk image')
  await expect(openGithubReleaseInstaller('/cache/update.dmg', 'darwin')).rejects.toThrow('Cannot open disk image')
  expect(native.quit).not.toHaveBeenCalled()
})

it('reveals a Linux AppImage for manual replacement without starting a second instance', async () => {
  await openGithubReleaseInstaller('/cache/update.AppImage', 'linux')
  expect(native.showItemInFolder).toHaveBeenCalledWith('/cache/update.AppImage')
  expect(native.spawn).not.toHaveBeenCalled()
  expect(native.quit).not.toHaveBeenCalled()
})

it('retains a detached failure as an actionable install error and consumes it only once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'neurix-install-report-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  expect(await readGithubReleaseInstallationFailure(directory, '1.0.0')).toBeUndefined()
  await writeFile(join(directory, 'install-result.json'), JSON.stringify({ status: 'error', version: '1.0.1', message: 'launch denied' }))
  expect(await readGithubReleaseInstallationFailure(directory, '1.0.0')).toMatchObject({ phase: 'error', failedOperation: 'install', version: '1.0.1', message: 'launch denied' })
  expect(await readGithubReleaseInstallationFailure(directory, '1.0.0')).toBeUndefined()
  await writeFile(join(directory, 'install-result.json'), JSON.stringify({ status: 'error' }))
  await expect(readGithubReleaseInstallationFailure(directory, '1.0.0')).rejects.toThrow('Invalid recorded installation')
})

it('stages the running Linux AppImage beside its real path without modifying it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'neurix-appimage-install-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const installed = join(directory, 'Neurix Harness.AppImage'), download = join(directory, 'new.AppImage'), work = join(directory, 'work')
  await writeFile(installed, 'old executable')
  await writeFile(download, 'verified new executable')
  await mkdir(work)
  vi.stubEnv('APPIMAGE', installed)
  const plan = await stageGithubReleaseReplacement(download, 'linux', '1.0.1', work)
  expect(await readFile(plan.installed, 'utf8')).toBe('old executable')
  expect(await readFile(plan.prepared, 'utf8')).toBe('verified new executable')
})

it.skipIf(process.platform !== 'darwin')('mounts and verifies a real DMG, stages its app without changing the installed one, and releases the backup only on the matching version', async () => {
  const execute = promisify(execFile)
  const directory = await mkdtemp(join(tmpdir(), 'neurix-dmg-install-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const installed = join(directory, 'Neurix Harness.app'), imageRoot = join(directory, 'image'), work = join(directory, 'work')
  const incoming = join(imageRoot, 'Neurix Harness.app')
  for (const [path, version] of [[installed, '1.0.0'], [incoming, '1.0.1']] as const) {
    await mkdir(join(path, 'Contents/MacOS'), { recursive: true })
    await copyFile('/usr/bin/true', join(path, 'Contents/MacOS/Neurix'))
    await writeFile(join(path, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.example.neurix-test</string><key>CFBundleExecutable</key><string>Neurix</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>\n`)
    await execute('/usr/bin/codesign', ['--force', '--sign', '-', path])
  }
  native.getAppPath.mockReturnValue(join(installed, 'Contents/Resources/app.asar'))
  await mkdir(work)
  const dmg = join(directory, 'update.dmg')
  await execute('/usr/bin/hdiutil', ['create', '-srcfolder', imageRoot, '-format', 'UDZO', dmg])
  const plan = await stageGithubReleaseReplacement(dmg, 'darwin', '1.0.1', work)
  expect(await readFile(join(installed, 'Contents/Info.plist'), 'utf8')).toContain('1.0.0')
  expect(await readFile(join(plan.prepared, 'Contents/Info.plist'), 'utf8')).toContain('1.0.1')
  await expect(execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', plan.prepared])).resolves.toBeDefined()
  await writeFile(join(directory, 'install-result.json'), JSON.stringify({ status: 'handoff', version: '1.0.1', installed, staging: join(plan.prepared, '..') }))
  expect(await readGithubReleaseInstallationFailure(directory, '1.0.0')).toMatchObject({ phase: 'error', failedOperation: 'install' })
  expect(await readFile(join(plan.prepared, 'Contents/Info.plist'), 'utf8')).toContain('1.0.1')
  expect(await readGithubReleaseInstallationFailure(directory, '1.0.1')).toBeUndefined()
  await expect(readFile(join(plan.prepared, 'Contents/Info.plist'))).rejects.toMatchObject({ code: 'ENOENT' })
  const retryWork = join(directory, 'retry')
  await mkdir(retryWork)
  await expect(stageGithubReleaseReplacement(dmg, 'darwin', '2.0.0', retryWork)).rejects.toThrow('does not match')
}, Math.max(120_000, Number(process.env.DSH_COVERAGE_TEST_TIMEOUT_MS ?? 0)))
