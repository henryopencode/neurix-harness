/** Stable numbering and admission rules for the fork's release workflow. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { nextStableDesktopVersion } from './desktop-stable.ts'
import { GithubReleaseDownloads } from '../../apps/desktop/src/github-release-downloads.ts'

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

it('packages master pushes, including merged pull requests, and permits validation dispatches', () => {
  const workflow = yaml.load(readFileSync(new URL('../../.github/workflows/neurix-desktop-release.yml', import.meta.url), 'utf8')) as {
    on: Record<string, unknown>
    jobs: {
      version: { if: string }
      package: { strategy: { matrix: string } }
      publish: { needs: string[] }
    }
  }
  expect(workflow.on).not.toHaveProperty('pull_request')
  expect(workflow.on.push).toEqual({ branches: ['master'] })
  expect(workflow.jobs.version.if).toContain("github.event_name == 'push' && github.ref == 'refs/heads/master'")
  expect(workflow.jobs.version.if).toContain("github.event_name == 'workflow_dispatch'")
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
  for (const asset of ['win-x64-unsigned.exe', 'mac-arm64-unsigned.dmg', 'mac-x64-unsigned.dmg', 'linux-x86_64-unsigned.AppImage', 'linux-x64-server.tar.gz']) {
    expect(content).toContain(`neurix-harness-$RELEASE_VERSION-${asset}`)
  }
  expect(content.indexOf('test -s "$asset"')).toBeLessThan(content.indexOf('sha256sum --'))
  expect(content).toContain("fs.writeFileSync('desktop-update.json'")
  expect(content.indexOf("fs.writeFileSync('desktop-update.json'")).toBeLessThan(content.indexOf('gh release create'))
  for (const test of ['github-release-downloads.spec.ts', 'github-release-installer.spec.ts', 'github-release-replacement.spec.ts',
    'update-schedule.spec.ts', 'update-coordinator.spec.ts', 'scripts/deploy/test_server_update.py', 'scripts/deploy/server-update-control.test.mjs']) {
    expect(content).toContain(test)
  }
  expect(content).toContain('"$RELEASE_COMMIT" "$GITHUB_SERVER_URL" "$GH_REPO" "$GITHUB_RUN_ID"')
})

it('produces public metadata that all four desktop targets can discover and download with matching checksums', async () => {
  const workflow = yaml.load(readFileSync(new URL('../../.github/workflows/neurix-desktop-release.yml', import.meta.url), 'utf8')) as {
    jobs: { publish: { steps: { name?: string; run?: string }[] } }
  }
  const publication = workflow.jobs.publish.steps.find(step => step.name === 'Publish complete platform set')?.run ?? ''
  const generate = /node --input-type=module <<'NODE'\n([\s\S]+?)\nNODE/u.exec(publication)?.[1]
  expect(generate).toBeDefined()
  if (generate === undefined) throw new Error('The stable release must produce its public update metadata')
  const directory = mkdtempSync(join(tmpdir(), 'neurix-published-feed-'))
  const payload = Buffer.from('installer bytes qualified by the release workflow')
  const targets = [['darwin', 'arm64', 'mac-arm64-unsigned.dmg'], ['darwin', 'x64', 'mac-x64-unsigned.dmg'],
    ['win32', 'x64', 'win-x64-unsigned.exe'], ['linux', 'x64', 'linux-x86_64-unsigned.AppImage']] as const
  try {
    const assets = join(directory, 'assets')
    mkdirSync(assets)
    const files = [...targets.map(([, , suffix]) => `neurix-harness-1.0.1-${suffix}`), 'neurix-harness-1.0.1-linux-x64-server.tar.gz']
    for (const file of files) writeFileSync(join(assets, file), payload)
    const hash = createHash('sha256').update(payload).digest('hex')
    writeFileSync(join(assets, 'SHA256SUMS.txt'), files.map(file => `${hash}  ${file}\n`).join(''))
    execFileSync(process.execPath, ['--input-type=module', '-e', generate], { cwd: assets, env: { RELEASE_TAG: 'v1.0.1' }, timeout: 10_000 })
    for (const [platform, arch, suffix] of targets) {
      const updates = new GithubReleaseDownloads('henryopencode/neurix-harness', '1.0.0', state => state, {
        directory: join(directory, `${platform}-${arch}`), platform, arch, installMode: 'restart',
        metadataTimeoutMs: 10_000, idleTimeoutMs: 10_000, beforeRestart: async () => true, install: async () => {},
        request: async url => new Response(new Uint8Array(readFileSync(join(assets, basename(new URL(url).pathname))))),
      })
      try {
        expect(await updates.check()).toMatchObject({ phase: 'available', version: '1.0.1' })
        expect(await updates.download('1.0.1')).toMatchObject({ phase: 'ready', installMode: 'restart' })
        expect(readFileSync(join(directory, `${platform}-${arch}`, `neurix-harness-1.0.1-${suffix}`))).toEqual(payload)
      } finally { updates.dispose() }
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
