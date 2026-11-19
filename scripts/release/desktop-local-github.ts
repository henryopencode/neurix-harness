/** Stage and verify GitHub Release assets without using Actions artifacts. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gt, valid } from 'semver'
import { z } from 'zod'
import { measureDesktopReleaseAsset, readDesktopReleaseBuilds, type DesktopReleaseAsset } from './desktop-local-assets.ts'
import type { StableDesktopRelease } from './desktop-stable.ts'

const releaseFields = z.object({
  id: z.int().positive(), tag_name: z.string(), draft: z.boolean(), prerelease: z.boolean(),
  body: z.string().nullable(), html_url: z.url(),
})
const remoteAssetFields = z.object({
  id: z.int().positive(), name: z.string(), size: z.int().nonnegative(), digest: z.string().nullable(), state: z.string(),
})
type GithubRelease = z.infer<typeof releaseFields>
type GithubAsset = z.infer<typeof remoteAssetFields>
type Gh = (args: string[]) => string
const metadataName = 'desktop-update.json'
const checksumsName = 'SHA256SUMS.txt'
const qualification = 'Qualification: local Desktop release'

function matchAssets(
  remote: readonly GithubAsset[],
  expected: readonly DesktopReleaseAsset[],
  complete: boolean,
): Map<string, GithubAsset> {
  const matched = new Map<string, GithubAsset>()
  for (const asset of remote) {
    const file = expected.find(item => item.name === asset.name)
    if (file === undefined || matched.has(asset.name) || asset.state !== 'uploaded'
      || asset.size !== file.size || asset.digest !== `sha256:${file.sha256}`) {
      throw new Error(`GitHub asset ${asset.name} does not match this build. Inspect the Release before continuing.`)
    }
    matched.set(asset.name, asset)
  }
  if (complete && matched.size !== expected.length) {
    throw new Error(`Missing GitHub assets: ${expected.filter(file => !matched.has(file.name)).map(file => file.name).join(', ')}. Run draft first.`)
  }
  return matched
}

function readReleases(gh: Gh, repo: string, tag: string): GithubRelease[] {
  const fields = `.[] | {id, tag_name, draft, prerelease, body: (if .tag_name == ${JSON.stringify(tag)} then .body else null end), html_url}`
  return gh(['api', '--paginate', `repos/${repo}/releases?per_page=100`, '--jq', fields]).split('\n')
    .filter(Boolean).map(line => releaseFields.parse(JSON.parse(line)))
}

function readAssets(gh: Gh, repo: string, id: number): GithubAsset[] {
  return z.array(z.array(remoteAssetFields)).parse(JSON.parse(gh(
    ['api', '--paginate', '--slurp', `repos/${repo}/releases/${id}/assets?per_page=100`],
  ))).flat()
}

function requireOwnedRelease(remote: GithubRelease, release: StableDesktopRelease): void {
  const lines = remote.body?.split('\n')
  if (remote.tag_name !== release.tag || remote.prerelease || !lines?.includes(qualification)
    || !lines.includes(`Source: ${release.commit}`)) {
    throw new Error(`The Release for ${release.tag} belongs to another publisher or commit: ${remote.html_url}`)
  }
}

function ensureLatestVersion(releases: readonly GithubRelease[], release: StableDesktopRelease): void {
  const newer = releases.find((item) => {
    const version = item.tag_name.slice(1)
    return !item.draft && !item.prerelease && /^v\d+\.\d+\.\d+$/u.test(item.tag_name)
      && valid(version) === version && gt(version, release.version)
  })
  if (newer !== undefined) throw new Error(`${newer.tag_name} is already published. Reserve a newer stable version.`)
}

function writeGithub(gh: Gh, args: string[], url: string, operation: string): void {
  try {
    gh(args)
  } catch (error) {
    throw new Error(`GitHub did not confirm ${operation}. Inspect ${url} before retrying.`, { cause: error })
  }
}

function uploadMissing(
  gh: Gh, repo: string, release: GithubRelease, expected: readonly DesktopReleaseAsset[], existing: ReadonlyMap<string, GithubAsset>,
): void {
  const missing = expected.filter(item => !existing.has(item.name))
  if (missing.length === 0) return
  console.log(`Uploading ${missing.map(item => item.name).join(', ')}`)
  writeGithub(gh, ['release', 'upload', release.tag_name, '--repo', `github.com/${repo}`, ...missing.map(item => item.path)],
    release.html_url, 'draft upload')
}

/**
 * Stage the full Release or publish a matching draft. Uploads resume without replacing files.
 * @param gh - GitHub CLI adapter for the verified GitHub repository.
 * @param repo - Owner and name of the repository holding the reservation.
 * @param release - Reservation verified against the remote paired tags.
 * @param directory - Parent of all four qualified platform directories.
 * @param mode - Draft uploads assets; publish only verifies and promotes an existing draft.
 * @returns URL of the verified draft or published Release.
 * @throws On any disagreement or if GitHub cannot confirm the result. Inspect a partial draft before retrying.
 */
export async function submitLocalDesktopRelease(
  gh: Gh,
  repo: string,
  release: StableDesktopRelease,
  directory: string,
  mode: 'draft' | 'publish',
): Promise<string> {
  const installers = await readDesktopReleaseBuilds(release, directory)
  const list = readReleases(gh, repo, release.tag)
  let current = list.find(item => item.tag_name === release.tag)
  if (current?.draft !== false) ensureLatestVersion(list, release)
  const work = mkdtempSync(join(tmpdir(), 'neurix-release-'))
  try {
    if (current === undefined) {
      if (mode === 'publish') throw new Error(`No draft for ${release.tag}. Run draft first.`)
      const notes = join(work, 'release-notes.md')
      writeFileSync(notes, [
        'Windows x64, macOS Apple Silicon, macOS Intel, and Linux x64 installers.',
        '', 'Windows installers are unsigned. macOS installers use ad-hoc signing without notarization.',
        '', `Source: ${release.commit}`, qualification, '',
      ].join('\n'))
      writeGithub(gh, ['release', 'create', release.tag, '--repo', `github.com/${repo}`, '--verify-tag', '--draft',
        '--title', `Neurix Harness ${release.tag}`, '--notes-file', notes], `https://github.com/${repo}/releases`, 'draft creation')
      current = readReleases(gh, repo, release.tag).find(item => item.tag_name === release.tag)
      if (current === undefined) throw new Error(`Draft ${release.tag} is not visible yet. Inspect Releases before retrying.`)
    }
    requireOwnedRelease(current, release)
    if (mode === 'draft' && !current.draft) throw new Error(`${release.tag} is already published: ${current.html_url}`)

    writeFileSync(join(work, checksumsName), installers.map(file => `${file.sha256}  ${file.name}\n`).join(''))
    const base = [...installers, await measureDesktopReleaseAsset(work, checksumsName)]
    const id = current.id
    const read = () => readAssets(gh, repo, id)
    const baseAssets = () => read().filter(asset => asset.name !== metadataName)
    if (mode === 'draft') uploadMissing(gh, repo, current, base, matchAssets(baseAssets(), base, false))
    const uploaded = matchAssets(baseAssets(), base, true)
    writeFileSync(join(work, metadataName), `${JSON.stringify({
      tag_name: release.tag, draft: false, prerelease: false,
      assets: base.map(({ name, size, sha256 }) => ({ name, size, sha256, id: uploaded.get(name)?.id })),
    })}\n`)
    const metadata = await measureDesktopReleaseAsset(work, metadataName)
    const expected = [...base, metadata]
    if (mode === 'draft') uploadMissing(gh, repo, current, [metadata], matchAssets(read(), expected, false))
    matchAssets(read(), expected, true)

    if (mode === 'publish' && current.draft) {
      const endpoint = `repos/${repo}/releases/${id}`
      writeGithub(gh, ['api', '--method', 'PATCH', endpoint, '--silent', '-F', 'draft=false', '-f', 'make_latest=legacy'],
        current.html_url, 'publication')
      try {
        const published = releaseFields.parse(JSON.parse(gh(['api', endpoint])))
        requireOwnedRelease(published, release)
        if (published.draft) throw new Error('GitHub still reports a draft')
        matchAssets(read(), expected, true)
        return published.html_url
      } catch (error) {
        throw new Error(`Could not verify the published Release. Inspect ${current.html_url} before retrying.`, { cause: error })
      }
    }
    return current.html_url
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}
