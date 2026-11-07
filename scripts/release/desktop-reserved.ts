/** Resolve an existing immutable Desktop reservation for another packaging attempt. */
import { appendFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import type { StableDesktopRelease } from './desktop-stable.ts'
import { capture, isEntry } from './process.ts'

/**
 * Read a stable reservation whose paired tags and recorded source belong to master.
 * @param root - Checkout containing the complete master history and release tags.
 * @param tag - Existing stable v-prefixed release tag.
 * @returns Original version, tag, and commit without changing Git or workspace files.
 * @throws When tags, manifest version, reservation metadata, or master ancestry disagree.
 */
export function readReservedDesktopRelease(root: string, tag: string): StableDesktopRelease {
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(tag)) {
    throw new Error('An existing Desktop reservation requires a stable v-prefixed tag')
  }
  const git = (...args: string[]) => capture('git', args, { cwd: root })
  const commit = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`)
  if (git('rev-parse', '--verify', `refs/tags/dsh-${tag}^{commit}`) !== commit) {
    throw new Error('The Desktop and dsh release tags identify different commits')
  }
  const manifest: unknown = JSON.parse(git('show', `${commit}:package.json`))
  if (manifest === null || typeof manifest !== 'object' || !('version' in manifest) || manifest.version !== tag.slice(1)) {
    throw new Error('The reserved manifest version does not match the Desktop tag')
  }
  const source = /^Neurix-Release-Source: ([a-f0-9]{40})$/mu.exec(git('log', '-1', '--format=%B', commit))?.[1]
  if (source === undefined) throw new Error('The tagged commit has no Desktop reservation source')
  git('merge-base', '--is-ancestor', source, commit)
  git('merge-base', '--is-ancestor', commit, 'refs/remotes/origin/master')
  return { version: tag.slice(1), tag, commit }
}

if (isEntry(import.meta.url)) {
  const { values } = parseArgs({ options: { tag: { type: 'string' } } })
  if (values.tag === undefined) throw new Error('--tag is required')
  if (process.env.GITHUB_OUTPUT === undefined) throw new Error('GITHUB_OUTPUT is required')
  const release = readReservedDesktopRelease(process.cwd(), values.tag)
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(release).map(([key, value]) => `${key}=${value}\n`).join(''))
  console.log(`Reusing ${release.tag} at ${release.commit}`)
}
