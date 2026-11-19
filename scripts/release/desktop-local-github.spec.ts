/** Verify the local Release payload and the draft-to-published transition without a GitHub account. */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { GithubReleaseDownloads } from '../../apps/desktop/src/github-release-downloads.ts'
import { recordDesktopReleaseBuild } from './desktop-local-assets.ts'
import { submitLocalDesktopRelease } from './desktop-local-github.ts'

const repo = 'example/desktop'
const release = { tag: 'v1.0.1', version: '1.0.1', commit: 'a'.repeat(40) }
const payload = Buffer.from('installer bytes from a qualified platform build')

async function builds() {
  const root = mkdtempSync(join(tmpdir(), 'neurix-local-release-test-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) })
  const directory = join(root, 'qualified')
  const targets = [
    ['mac-arm64', 'mac-arm64-unsigned.dmg'], ['mac-x64', 'mac-x64-unsigned.dmg'],
    ['win-x64', 'win-x64-unsigned.exe'], ['linux-x64', 'linux-x86_64-unsigned.AppImage', 'linux-x64-server.tar.gz'],
  ] as const
  for (const [target, ...files] of targets) {
    for (const file of files) writeFileSync(join(root, `neurix-harness-1.0.1-${file}`), payload)
    await recordDesktopReleaseBuild(release, target, root, directory)
  }
  return { root, directory }
}

function github() {
  const header = {
    id: 101, tag_name: release.tag, draft: true, prerelease: false, body: '',
    html_url: `https://github.com/${repo}/releases/tag/${release.tag}`,
  }
  let exists = false
  let uploads = 0
  let publications = 0
  const assets = new Map<string, { id: number; name: string; digest: string; state: string; size: number; bytes: Buffer }>()
  const additionalReleases: (typeof header)[] = []
  const gh = (args: string[]): string => {
    const [command, action, ...rest] = args
    if (command === 'api' && action === '--paginate') {
      if (rest[0] === `repos/${repo}/releases?per_page=100` && rest[1] === '--jq') {
        return [...additionalReleases, ...(exists ? [header] : [])].map(item => JSON.stringify(item)).join('\n')
      }
      if (rest[0] === '--slurp' && rest[1] === `repos/${repo}/releases/101/assets?per_page=100`) return JSON.stringify([[...assets.values()]])
    }
    if (command === 'release' && action === 'create') {
      expect(exists).toBe(false)
      expect(rest).toEqual(expect.arrayContaining([release.tag, '--verify-tag', '--draft', `github.com/${repo}`]))
      header.body = readFileSync(rest[rest.indexOf('--notes-file') + 1]!, 'utf8')
      exists = true
      return ''
    }
    if (command === 'release' && action === 'upload') {
      expect(header.draft).toBe(true)
      expect(rest.slice(0, 3)).toEqual([release.tag, '--repo', `github.com/${repo}`])
      for (const path of rest.slice(3)) {
        const name = basename(path)
        expect(assets.has(name)).toBe(false)
        const bytes = readFileSync(path)
        assets.set(name, { id: 200 + assets.size, name, size: bytes.length, state: 'uploaded', bytes,
          digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex') })
        uploads++
      }
      return ''
    }
    if (command === 'api' && action === '--method') {
      expect(rest).toEqual(['PATCH', `repos/${repo}/releases/101`, '--silent', '-F', 'draft=false', '-f', 'make_latest=legacy'])
      expect(assets.size).toBe(7)
      publications++
      header.draft = false
      return ''
    }
    if (command === 'api' && action === `repos/${repo}/releases/101`) return JSON.stringify(header)
    throw new Error(`Unexpected GitHub command: ${args.join(' ')}`)
  }
  return { gh, assets, header, additionalReleases, writes: () => ({ uploads, publications }) }
}

it('stages a complete draft and only publishes it after explicit verification', async () => {
  const { directory, root } = await builds()
  const remote = github()
  const submit = (mode: 'draft' | 'publish') => submitLocalDesktopRelease(remote.gh, repo, release, directory, mode)
  await expect(submit('publish')).rejects.toThrow('Run draft first')
  await expect(submit('draft')).resolves.toBe(remote.header.html_url)
  expect(remote.header.draft).toBe(true)
  expect(remote.writes()).toEqual({ uploads: 7, publications: 0 })
  await submit('draft')
  expect(remote.writes()).toEqual({ uploads: 7, publications: 0 })

  const metadata = remote.assets.get('desktop-update.json')!
  const checksums = remote.assets.get('SHA256SUMS.txt')!
  expect(checksums.bytes.toString()).toContain(`${createHash('sha256').update(payload).digest('hex')}  neurix-harness-1.0.1-linux-x64-server.tar.gz\n`)
  await expect(submit('publish')).resolves.toBe(remote.header.html_url)
  await submit('publish')
  expect(remote.writes()).toEqual({ uploads: 7, publications: 1 })
  const downloads = new GithubReleaseDownloads(repo, '1.0.0', state => state, {
    directory: join(root, 'updates'), platform: 'darwin', arch: 'arm64', installMode: 'restart',
    metadataTimeoutMs: 10_000, idleTimeoutMs: 10_000, beforeRestart: async () => true, install: async () => {},
    request: async (url) => {
      if (url.endsWith('/desktop-update.json')) return new Response(Uint8Array.from(metadata.bytes))
      if (url.startsWith('https://github.com/')) return new Response(null, { status: 504 })
      const asset = [...remote.assets.values()].find(item => String(item.id) === basename(new URL(url).pathname))
      if (asset === undefined) throw new Error('Unknown release asset')
      return new Response(Uint8Array.from(asset.bytes))
    },
  })
  try {
    expect(await downloads.check()).toMatchObject({ phase: 'available', version: release.version })
    expect(await downloads.download(release.version)).toMatchObject({ phase: 'ready' })
  } finally { downloads.dispose() }
})

it('refuses a mixed checkout or a damaged installer before contacting GitHub', async () => {
  const { directory } = await builds()
  const remote = () => { throw new Error('GitHub must not be contacted for unqualified files') }
  const submit = (reservation = release) => submitLocalDesktopRelease(remote, repo, reservation, directory, 'draft')
  await expect(submit({ ...release, commit: 'b'.repeat(40) })).rejects.toThrow('was not built from')
  writeFileSync(join(directory, 'mac-arm64', 'neurix-harness-1.0.1-mac-arm64-unsigned.dmg'), 'not the qualified installer')
  await expect(submit()).rejects.toThrow('Build checksum mismatch')
})

it('leaves the Release in draft when a remote checksum is wrong', async () => {
  const { directory } = await builds()
  const remote = github()
  await submitLocalDesktopRelease(remote.gh, repo, release, directory, 'draft')
  remote.assets.get('desktop-update.json')!.digest = 'sha256:' + '0'.repeat(64)
  await expect(submitLocalDesktopRelease(remote.gh, repo, release, directory, 'publish')).rejects.toThrow('does not match this build')
  expect(remote.header.draft).toBe(true)
  expect(remote.writes()).toEqual({ uploads: 7, publications: 0 })
})

it('does not publish a draft after a newer stable version is available', async () => {
  const { directory } = await builds()
  const remote = github()
  await submitLocalDesktopRelease(remote.gh, repo, release, directory, 'draft')
  remote.additionalReleases.push({ ...remote.header, id: 102, tag_name: 'v1.0.2', draft: false })
  await expect(submitLocalDesktopRelease(remote.gh, repo, release, directory, 'publish')).rejects.toThrow('v1.0.2 is already published')
  expect(remote.header.draft).toBe(true)
  expect(remote.writes()).toEqual({ uploads: 7, publications: 0 })
})
