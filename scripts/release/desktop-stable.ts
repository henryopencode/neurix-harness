/** Reserve stable Desktop versions on master and reuse reservations when a workflow is retried. */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { inc, maxSatisfying, valid, gt } from 'semver'
import { planShared } from './bump.ts'
import { releaseFamily } from './families.ts'
import { attempt, capture, isEntry, pnpmCommand } from './process.ts'

/** Version, tag, and immutable source shared by every platform build. */
export interface StableDesktopRelease {
  readonly version: string
  readonly tag: string
  readonly commit: string
}

/**
 * Select the first 1.0.0 release, a requested higher stable version, or the next patch.
 * @param current - Product manifest version, including development prereleases.
 * @param tags - Existing Git tags; only stable v1.0.0 and later tags count.
 * @param requested - Optional explicit major, minor, or patch release version.
 * @returns The next unused stable version.
 */
export function nextStableDesktopVersion(current: string, tags: readonly string[], requested?: string): string {
  const versions = tags.filter(tag => /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(tag)).map(tag => tag.slice(1))
  const last = maxSatisfying(versions, '>=1.0.0')
  const next = last === null ? '1.0.0' : inc(last, 'patch')
  if (next === null) throw new Error('The stable release version cannot be incremented')
  const selected = requested ?? (valid(current) === current && !current.includes('-') && gt(current, next) ? current : next)
  if (valid(selected) !== selected || selected.includes('-') || selected.includes('+') || gt(next, selected)) {
    throw new Error(`Desktop release version must be a stable version at least ${next}`)
  }
  return selected
}

function tags(): string[] { return capture('git', ['tag', '--list', 'v*']).split('\n').filter(Boolean) }

function reserved(source: string): StableDesktopRelease | undefined {
  for (const tag of tags()) {
    if (!/^v\d+\.\d+\.\d+$/u.test(tag)) continue
    const body = capture('git', ['show', '-s', '--format=%B', `${tag}^{commit}`])
    if (!body.split('\n').includes(`Neurix-Release-Source: ${source}`)) continue
    return { version: tag.slice(1), tag, commit: capture('git', ['rev-parse', `${tag}^{commit}`]) }
  }
  return undefined
}

/**
 * Commit aligned workspace versions and atomically push master with both release tags.
 * Concurrent merges retry against the newer master without overwriting remote work.
 * @param source - Merged commit that caused this release, retained for retry identity.
 * @param requested - Optional explicit stable version.
 * @returns The reserved release, including a previous successful reservation on retry.
 */
export function reserveStableDesktopRelease(source: string, requested?: string): StableDesktopRelease {
  if (process.env.GITHUB_ACTIONS !== 'true' || !/^[a-f0-9]{40}$/u.test(source)) {
    throw new Error('Desktop version reservation requires a GitHub Actions checkout and a full merged commit SHA')
  }
  if (capture('git', ['status', '--porcelain']) !== '') throw new Error('Desktop version reservation requires a clean checkout')
  for (let retry = 0; retry < 5; retry++) {
    capture('git', ['fetch', 'origin', 'master', '--tags'])
    const existing = reserved(source)
    if (existing !== undefined) return existing
    capture('git', ['merge-base', '--is-ancestor', source, 'origin/master'])
    const base = capture('git', ['rev-parse', 'origin/master'])
    capture('git', ['checkout', '-B', 'desktop-release-version', base])
    const root = process.cwd()
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
    const version = nextStableDesktopVersion(manifest.version, tags(), requested)
    const family = releaseFamily('dsh')
    const members = family.members(root)
    family.verifyVersions(members)
    const { planned } = planShared(family, root, members, version)
    for (const entry of planned) {
      const content = JSON.parse(readFileSync(entry.manifestPath, 'utf8')) as Record<string, unknown>
      writeFileSync(entry.manifestPath, `${JSON.stringify({ ...content, version }, null, 2)}\n`)
    }
    const [pnpm, ...prefix] = pnpmCommand()
    capture(pnpm, [...prefix, 'install', '--lockfile-only', '--ignore-scripts'])
    capture('git', ['add', 'pnpm-lock.yaml', ...planned.map(entry => entry.manifestPath)])
    capture('git', ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'commit', '-m', `release(desktop): ${version} [skip ci]\n\nNeurix-Release-Source: ${source}`])
    const releaseTags = [`v${version}`, `dsh-v${version}`]
    for (const tag of releaseTags) capture('git', ['tag', tag])
    const result = attempt('git', ['push', '--atomic', 'origin', 'HEAD:refs/heads/master', ...releaseTags.map(tag => `refs/tags/${tag}`)])
    if (result.status === 0) return { version, tag: `v${version}`, commit: capture('git', ['rev-parse', 'HEAD']) }
    for (const tag of releaseTags) capture('git', ['tag', '-d', tag])
    capture('git', ['fetch', 'origin', 'master', '--tags'])
    if (capture('git', ['rev-parse', 'origin/master']) === base) throw new Error(`Desktop release push failed: ${result.stderr}`)
  }
  throw new Error('Master kept changing during version reservation; rerun this workflow')
}

if (isEntry(import.meta.url)) {
  const { values } = parseArgs({ options: { plan: { type: 'boolean' }, version: { type: 'string' } } })
  if (values.plan) {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
    console.log(nextStableDesktopVersion(manifest.version, tags(), values.version || undefined))
  } else {
    const release = reserveStableDesktopRelease(process.env.RELEASE_SOURCE ?? '', values.version || undefined)
    if (process.env.GITHUB_OUTPUT === undefined) throw new Error('GITHUB_OUTPUT is required')
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(release).map(([key, value]) => `${key}=${value}\n`).join(''))
    console.log(`Reserved ${release.tag} at ${release.commit}`)
  }
}
