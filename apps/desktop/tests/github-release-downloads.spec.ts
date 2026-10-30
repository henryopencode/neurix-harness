/** Real cache files and streamed network responses; installer execution stays outside this process. */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopUpdateState } from '../src/ipc.ts'
import { desktopGithubRepository, GithubReleaseDownloads } from '../src/github-release-downloads.ts'

const bytes = Buffer.from('a verified installer fixture')
const checksum = createHash('sha256').update(bytes).digest('hex')
function filename(platform = 'darwin') {
  return `neurix-harness-1.0.0-${platform === 'darwin' ? 'mac-arm64-unsigned.dmg' : platform === 'win32' ? 'win-x64-unsigned.exe' : 'linux-x86_64-unsigned.AppImage'}`
}
function metadata(platform = 'darwin') {
  return { tag_name: 'v1.0.0', draft: false, prerelease: false,
    assets: [{ name: filename(platform), size: bytes.length, browser_download_url: 'https://untrusted.invalid/ignored' }, { name: 'SHA256SUMS.txt' }] }
}
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

async function fixture(platform: NodeJS.Platform = 'darwin') {
  const directory = await mkdtemp(join(tmpdir(), 'neurix-release-download-'))
  const publish = vi.fn((state: DesktopUpdateState) => state)
  const install = vi.fn(async (_file: string) => {})
  const beforeRestart = vi.fn(async () => true)
  const request = vi.fn(async (url: string, _init: { signal: AbortSignal }): Promise<Response> => {
    if (url.endsWith('/latest')) return Response.json(metadata(platform))
    if (url.endsWith('SHA256SUMS.txt')) return new Response(`${checksum}  ${filename(platform)}\n`)
    return new Response(bytes)
  })
  const updates = new GithubReleaseDownloads('henryopencode/neurix-harness', '0.2.1-rc.3', publish, {
    directory, request, install, beforeRestart, installMode: platform === 'win32' ? 'restart' : 'installer',
    platform, arch: platform === 'darwin' ? 'arm64' : 'x64',
  })
  cleanups.push(async () => { updates.dispose(); await updates.cancel(); await rm(directory, { recursive: true, force: true }) })
  return { directory, updates, publish, install, beforeRestart, request }
}

describe('GitHub release downloads', () => {
  it('retains managed updates for older packages and rejects non-repository destinations', () => {
    expect(desktopGithubRepository({})).toBeUndefined()
    expect(desktopGithubRepository({ dshDesktopGithubRepository: 'henryopencode/neurix-harness' })).toBe('henryopencode/neurix-harness')
    for (const value of ['https://example.com', '../repo', 'owner/repo/extra', '']) {
      expect(() => desktopGithubRepository({ dshDesktopGithubRepository: value })).toThrow(/owner\/repository/u)
    }
  })
  it.each(['darwin', 'win32', 'linux'] as const)('verifies %s bytes before a separate installer action and retains ready state across polling', async (platform) => {
    const f = await fixture(platform)
    expect(await f.updates.check()).toMatchObject({ phase: 'available', version: '1.0.0' })
    expect(await f.updates.download('1.0.0')).toMatchObject({ phase: 'ready', version: '1.0.0' })
    expect(await readFile(join(f.directory, filename(platform)))).toEqual(bytes)
    expect(f.install).not.toHaveBeenCalled()
    expect((await f.updates.check()).phase).toBe('ready')
    expect(f.request).toHaveBeenCalledTimes(3)
    await f.updates.install('1.0.0')
    expect(f.install).toHaveBeenCalledExactlyOnceWith(join(f.directory, filename(platform)))
    expect(f.beforeRestart).toHaveBeenCalledTimes(platform === 'win32' ? 1 : 0)
    expect(f.request.mock.calls.every(([url]) => !url.includes('untrusted.invalid'))).toBe(true)
  })
  it('keeps partial transfers cancellable, cleans up before re-download, and never opens an incomplete installer', async () => {
    const f = await fixture()
    await f.updates.check()
    const started = Promise.withResolvers<undefined>()
    f.request.mockImplementationOnce(async () => new Response(`${checksum}  ${filename()}\n`))
      .mockImplementationOnce(async (_url, { signal }) => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 10))
          signal.addEventListener('abort', () => { controller.error(signal.reason) }, { once: true })
          started.resolve(undefined)
        },
      })))
    const download = f.updates.download('1.0.0')
    await started.promise
    await vi.waitFor(() => { expect(f.updates.state.percent).toBeGreaterThan(0) })
    expect(f.updates.state).toMatchObject({ phase: 'downloading', canCancel: true })
    await f.updates.cancel()
    expect((await download).phase).toBe('available')
    expect(await readdir(f.directory)).toEqual([])
    expect(f.install).not.toHaveBeenCalled()
    expect((await f.updates.download('1.0.0')).phase).toBe('ready')
    expect(f.publish.mock.calls.some(([state]) => state.phase === 'verifying')).toBe(true)
  })
  it.each(['checksum', 'truncated', 'oversized'] as const)('refuses %s transfers and leaves no installer to execute', async (failure) => {
    const f = await fixture()
    await f.updates.check()
    f.request.mockImplementationOnce(async () => new Response(`${failure === 'checksum' ? '0'.repeat(64) : checksum}  ${filename()}\n`))
      .mockImplementationOnce(async () => new Response(failure === 'truncated' ? bytes.subarray(0, 2)
        : failure === 'oversized' ? Buffer.concat([bytes, bytes]) : bytes))
    expect(await f.updates.download('1.0.0')).toMatchObject({ phase: 'error', failedOperation: 'download' })
    expect(await readdir(f.directory)).toEqual([])
    expect((await f.updates.install('1.0.0')).phase).toBe('error')
    expect(f.install).not.toHaveBeenCalled()
  })
  it('refuses cache tampering, retains an installer after cancelled task confirmation, and reports handoff failures', async () => {
    const f = await fixture('win32')
    await f.updates.check()
    await f.updates.download('1.0.0')
    f.beforeRestart.mockResolvedValueOnce(false)
    expect((await f.updates.install('1.0.0')).phase).toBe('ready')
    expect(f.install).not.toHaveBeenCalled()
    f.install.mockRejectedValueOnce(new Error('installer spawn failed'))
    expect(await f.updates.install('1.0.0')).toMatchObject({ phase: 'error', failedOperation: 'install' })
    f.beforeRestart.mockResolvedValueOnce(false)
    expect((await f.updates.install('1.0.0')).phase).toBe('ready')
    await writeFile(join(f.directory, filename('win32')), 'changed')
    expect(await f.updates.install('1.0.0')).toMatchObject({ phase: 'error', failedOperation: 'download' })
    expect(f.install).toHaveBeenCalledTimes(1)
  })
  it('reports no update before the first release and rejects stale download confirmations', async () => {
    const f = await fixture()
    f.request.mockResolvedValueOnce(new Response(null, { status: 404 }))
    expect(await f.updates.check()).toMatchObject({ phase: 'idle' })
    expect((await f.updates.download('1.0.0')).failedOperation).toBe('download')
    expect(f.install).not.toHaveBeenCalled()
  })
  it.each([
    { ...metadata(), tag_name: 'v1.0.0-rc.1' },
    { ...metadata(), draft: true },
    { ...metadata(), prerelease: true },
    { ...metadata(), assets: [] },
  ])('retains a visible retry after invalid release metadata', async (release) => {
    const f = await fixture()
    f.request.mockResolvedValueOnce(Response.json(release))
    expect((await f.updates.check(true)).failedOperation).toBe('check')
    expect(f.updates.state.phase).toBe('error')
    expect(f.install).not.toHaveBeenCalled()
  })
  it('contains automatic network errors and prevents late publication after disposal', async () => {
    const f = await fixture()
    const pending = Promise.withResolvers<Response>()
    f.request.mockImplementationOnce(() => pending.promise)
    const check = f.updates.check()
    f.updates.dispose()
    pending.resolve(Response.json(metadata()))
    expect((await check).phase).toBe('error')
    expect(f.publish).not.toHaveBeenCalled()
  })
})
