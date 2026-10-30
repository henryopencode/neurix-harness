/** Installer argument and quit ordering without executing a downloaded binary. */
import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { openGithubReleaseInstaller } from '../src/github-release-installer.ts'

const native = vi.hoisted(() => ({ quit: vi.fn(), openPath: vi.fn(async (_file: string) => ''), showItemInFolder: vi.fn(), spawn: vi.fn() }))
vi.mock('electron', () => ({ app: { quit: native.quit }, shell: { openPath: native.openPath, showItemInFolder: native.showItemInFolder } }))
vi.mock('node:child_process', () => ({ spawn: native.spawn }))
afterEach(() => { vi.clearAllMocks() })

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
