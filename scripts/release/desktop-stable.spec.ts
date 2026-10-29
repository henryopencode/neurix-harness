/** Stable numbering and admission rules for the fork's release workflow. */
import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { nextStableDesktopVersion } from './desktop-stable.ts'

describe('stable Desktop versions', () => {
  it('starts at 1.0.0 without inheriting upstream prerelease numbers', () => {
    expect(nextStableDesktopVersion('0.2.1-rc.3', ['dsh-v0.2.1-rc.3', 'v0.9.9', 'v1.0.0-rc.1'])).toBe('1.0.0')
  })
  it('orders patch numbers numerically and advances the last stable release', () => {
    expect(nextStableDesktopVersion('1.0.2', ['v1.0.9', 'v1.0.10', 'v1.1.0-beta.1'])).toBe('1.0.11')
  })
  it('honors deliberate stable major and minor increases', () => {
    expect(nextStableDesktopVersion('1.1.0', ['v1.0.4'])).toBe('1.1.0')
    expect(nextStableDesktopVersion('1.0.4', ['v1.0.4'], '2.0.0')).toBe('2.0.0')
  })
  it.each(['0.9.0', '1.0.4', 'v2.0.0', '2.0.0-rc.1', '2.0.0+build', 'latest'])('rejects reused or nonstable version %s', (version) => {
    expect(() => nextStableDesktopVersion('1.0.4', ['v1.0.4'], version)).toThrow(/stable version/u)
  })
})

it('packages only after a same-repository develop merge or an explicit master dispatch', () => {
  const workflow = yaml.load(readFileSync(new URL('../../.github/workflows/neurix-desktop-release.yml', import.meta.url), 'utf8')) as {
    on: Record<string, unknown>
    jobs: {
      version: { if: string }
      package: { strategy: { matrix: string } }
      publish: { needs: string[] }
    }
  }
  expect(workflow.on).not.toHaveProperty('push')
  expect(workflow.on.pull_request).toEqual({ branches: ['master'], types: ['closed'] })
  expect(workflow.jobs.version.if).toContain('github.event.pull_request.merged == true')
  expect(workflow.jobs.version.if).toContain("github.event.pull_request.head.ref == 'develop'")
  expect(workflow.jobs.version.if).toContain('github.event.pull_request.head.repo.full_name == github.repository')
  expect(workflow.jobs.package.strategy.matrix).toBe('${{ fromJSON(needs.version.outputs.matrix) }}')
  const platforms = JSON.parse(readFileSync(new URL('../../.github/desktop-targets.json', import.meta.url), 'utf8')) as { target: string }[]
  expect(platforms.map(entry => entry.target)).toEqual(['win-x64', 'mac-arm64', 'mac-x64', 'linux-x64'])
  expect(workflow.jobs.publish.needs).toEqual(['version', 'package'])
})

it('publishes completed assets together and retains GitHub version ordering', () => {
  const content = readFileSync(new URL('../../.github/workflows/neurix-desktop-release.yml', import.meta.url), 'utf8')
  expect(content).toContain('--target "$RELEASE_COMMIT" --draft')
  expect(content).toContain('-F draft=false -f make_latest=legacy')
  expect(content.indexOf('sha256sum --')).toBeLessThan(content.indexOf('gh release create'))
  expect(content.indexOf('gh release upload')).toBeLessThan(content.indexOf('-F draft=false'))
})
