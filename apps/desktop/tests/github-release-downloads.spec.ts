/** GitHub metadata validation, download destinations, and disposal without installer execution. */
import { describe, expect, it, vi } from 'vitest'
import type { DesktopUpdateState } from '../src/ipc.ts'
import { desktopGithubRepository, GithubReleaseDownloads } from '../src/github-release-downloads.ts'

function metadata(version = '1.0.0') {
  return { tag_name: `v${version}`, draft: false, prerelease: false,
    assets: [{ name: `neurix-harness-${version}-mac-arm64-unsigned.dmg`, browser_download_url: 'https://untrusted.invalid/ignored' }] }
}

function fixture() {
  const publish = vi.fn((state: DesktopUpdateState) => state)
  const open = vi.fn(async () => {})
  const request = vi.fn(async () => Response.json(metadata()))
  const updates = new GithubReleaseDownloads('henryopencode/neurix-harness', '0.2.1-rc.3', publish, open, request, 'darwin', 'arm64')
  return { updates, publish, open, request }
}

describe('GitHub release downloads', () => {
  it('retains managed updates for older packages and rejects non-repository destinations', () => {
    expect(desktopGithubRepository({})).toBeUndefined()
    expect(desktopGithubRepository({ dshDesktopGithubRepository: 'henryopencode/neurix-harness' })).toBe('henryopencode/neurix-harness')
    for (const value of ['https://example.com', '../repo', 'owner/repo/extra', '']) {
      expect(() => desktopGithubRepository({ dshDesktopGithubRepository: value })).toThrow(/owner\/repository/u)
    }
  })
  it('checks a newer stable release and opens only its own installer without installation readiness', async () => {
    const f = fixture()
    try {
      expect(await f.updates.check()).toEqual({ phase: 'available', version: '1.0.0' })
      expect(await f.updates.download('1.0.0')).toEqual({ phase: 'available', version: '1.0.0' })
      expect(f.open).toHaveBeenCalledExactlyOnceWith('https://github.com/henryopencode/neurix-harness/releases/download/v1.0.0/neurix-harness-1.0.0-mac-arm64-unsigned.dmg')
      expect((await f.updates.install('1.0.0')).phase).toBe('error')
    } finally { f.updates.dispose() }
  })
  it('matches electron-builder Linux AppImage architecture names', async () => {
    const open = vi.fn(async () => {})
    const updates = new GithubReleaseDownloads('henryopencode/neurix-harness', '0.2.1-rc.3', state => state, open,
      async () => Response.json({ ...metadata(), assets: [{ name: 'neurix-harness-1.0.0-linux-x86_64-unsigned.AppImage' }] }), 'linux', 'x64')
    try {
      expect((await updates.check()).phase).toBe('available')
      await updates.download('1.0.0')
      expect(open).toHaveBeenCalledWith(expect.stringContaining('linux-x86_64-unsigned.AppImage'))
    } finally { updates.dispose() }
  })
  it('reports no update before the first release and rejects stale download confirmations', async () => {
    const f = fixture()
    try {
      f.request.mockResolvedValueOnce(new Response(null, { status: 404 }))
      expect(await f.updates.check()).toEqual({ phase: 'idle' })
      expect((await f.updates.download('1.0.0')).failedOperation).toBe('download')
      expect(f.open).not.toHaveBeenCalled()
    } finally { f.updates.dispose() }
  })
  it.each([
    { ...metadata(), tag_name: 'v1.0.0-rc.1' },
    { ...metadata(), draft: true },
    { ...metadata(), prerelease: true },
    { ...metadata(), assets: [] },
  ])('retains a visible retry after invalid release metadata', async (release) => {
    const f = fixture()
    try {
      f.request.mockResolvedValueOnce(Response.json(release))
      expect((await f.updates.check(true)).failedOperation).toBe('check')
      expect(f.updates.state.phase).toBe('error')
      expect(f.open).not.toHaveBeenCalled()
    } finally { f.updates.dispose() }
  })
  it('contains automatic network errors and prevents late publication after disposal', async () => {
    const f = fixture()
    let resolve: ((response: Response) => void) | undefined
    f.request.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done }))
    const check = f.updates.check()
    f.updates.dispose()
    resolve?.(Response.json(metadata()))
    expect((await check).phase).toBe('error')
    expect(f.publish).not.toHaveBeenCalled()
  })
})
