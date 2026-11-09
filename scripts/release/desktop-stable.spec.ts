/** Stable numbering and admission rules for the fork's release workflow. */
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import yaml from 'js-yaml'
import { describe, expect, it, onTestFinished } from 'vitest'
import { nextStableDesktopVersion } from './desktop-stable.ts'
import { GithubReleaseDownloads } from '../../apps/desktop/src/github-release-downloads.ts'

it('reserves and reuses immutable tags when the selected version already matches every manifest', ({ task }) => {
  const root = mkdtempSync(join(tmpdir(), 'neurix-version-reservation-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) })
  const repository = join(root, 'checkout')
  const remote = join(root, 'origin.git')
  const packageDirectory = join(repository, 'packages', 'test', 'fixture')
  const pnpmDirectory = join(root, 'pnpm')
  mkdirSync(packageDirectory, { recursive: true })
  mkdirSync(pnpmDirectory)
  const stub = join(pnpmDirectory, 'pnpm.mjs')
  const invoked = join(root, 'pnpm-invoked')
  writeFileSync(stub, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(invoked)}, 'used');\n`)
  writeFileSync(join(repository, 'package.json'), `${JSON.stringify({ name: '@deepseek-ai/dsh-root', private: true, version: '1.1.0' }, null, 2)}\n`)
  writeFileSync(join(packageDirectory, 'package.json'), `${JSON.stringify({ name: '@deepseek-ai/dsh-fixture', version: '1.1.0' }, null, 2)}\n`)
  writeFileSync(join(repository, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\nimporters: {}\n')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', timeout: task.timeout }).trim()
  git('init', '--bare', remote)
  git('init', '--initial-branch=master')
  git('config', 'user.name', 'Release fixture')
  git('config', 'user.email', 'release@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'tag.gpgsign', 'false')
  git('config', 'core.autocrlf', 'false')
  git('add', '.')
  git('commit', '-m', 'Prepare version 1.1.0')
  git('tag', 'v1.0.11')
  git('remote', 'add', 'origin', remote)
  git('push', 'origin', 'master', '--tags')
  const source = git('rev-parse', 'HEAD')
  const module = new URL('./desktop-stable.ts', import.meta.url).href
  const script = `import { reserveStableDesktopRelease } from ${JSON.stringify(module)}; const first = reserveStableDesktopRelease(${JSON.stringify(source)}); const retry = reserveStableDesktopRelease(${JSON.stringify(source)}); if (first.commit !== retry.commit) throw new Error('Retry changed the reservation');`
  // Windows preserves inherited key casing but compares environment names without case.
  const environment = { ...process.env }
  for (const key of Object.keys(environment)) if (key.toLowerCase() === 'npm_execpath') Reflect.deleteProperty(environment, key)
  environment.npm_execpath = stub
  environment.GITHUB_ACTIONS = 'true'
  const child = spawnSync(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href, '--input-type=module', '-e', script], {
    cwd: repository, encoding: 'utf8', timeout: task.timeout,
    env: environment,
  })
  expect(child.signal, child.stderr).toBeNull()
  expect(child.error).toBeUndefined()
  expect(child.status, child.stderr).toBe(0)
  expect(readFileSync(invoked, 'utf8')).toBe('used')
  const reservation = git('rev-parse', 'v1.1.0')
  expect(reservation).not.toBe(source)
  expect(git('rev-parse', 'v1.1.0^{tree}')).toBe(git('rev-parse', `${source}^{tree}`))
  expect(git('rev-parse', 'dsh-v1.1.0')).toBe(reservation)
  expect(git('log', '-1', '--format=%B', reservation)).toContain(`Neurix-Release-Source: ${source}`)
  const published = git('ls-remote', 'origin', 'refs/heads/master', 'refs/tags/v1.1.0', 'refs/tags/dsh-v1.1.0').split('\n')
  expect(published).toHaveLength(3)
  expect(published.every(line => line.startsWith(`${reservation}\t`))).toBe(true)
}, Number(process.env.DSH_COVERAGE_TEST_TIMEOUT_MS ?? '30000'))

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
  const qualify = [...publication.matchAll(/node --input-type=module <<'NODE'\n([\s\S]+?)\nNODE/gu)][1]?.[1]
  expect(generate).toBeDefined()
  if (generate === undefined) throw new Error('The stable release must produce its public update metadata')
  if (qualify === undefined) throw new Error('The stable release must bind alternate routes before publication')
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
    const metadata = JSON.parse(readFileSync(join(assets, 'desktop-update.json'), 'utf8')) as {
      assets: { name: string; size: number; sha256?: string }[]
    }
    const uploaded = metadata.assets.map((asset, index) => ({ ...asset, id: index + 100,
      digest: 'sha256:' + createHash('sha256').update(readFileSync(join(assets, asset.name))).digest('hex'),
    }))
    for (const file of files) expect(metadata.assets.find(asset => asset.name === file)?.sha256).toBe(hash)
    writeFileSync(join(directory, 'release-assets.json'), JSON.stringify(uploaded))
    execFileSync(process.execPath, ['--input-type=module', '-e', qualify], { cwd: assets, timeout: 10_000 })
    for (const [platform, arch, suffix] of targets) {
      const updates = new GithubReleaseDownloads('henryopencode/neurix-harness', '1.0.0', state => state, {
        directory: join(directory, `${platform}-${arch}`), platform, arch, installMode: 'restart',
        metadataTimeoutMs: 10_000, idleTimeoutMs: 10_000, beforeRestart: async () => true, install: async () => {},
        request: async (url) => {
          if (url.endsWith('/desktop-update.json')) return new Response(new Uint8Array(readFileSync(join(assets, 'desktop-update.json'))))
          if (url.startsWith('https://github.com/')) return new Response(null, { status: 504 })
          const asset = uploaded.find(asset => String(asset.id) === basename(new URL(url).pathname))
          if (asset === undefined) throw new Error('Update attempted an unexpected asset discovery request')
          return new Response(new Uint8Array(readFileSync(join(assets, asset.name))))
        },
      })
      try {
        expect(await updates.check()).toMatchObject({ phase: 'available', version: '1.0.1' })
        expect(await updates.download('1.0.1')).toMatchObject({ phase: 'ready', installMode: 'restart' })
        expect(readFileSync(join(directory, `${platform}-${arch}`, `neurix-harness-1.0.1-${suffix}`))).toEqual(payload)
      } finally { updates.dispose() }
    }
    uploaded[0]!.size++
    writeFileSync(join(directory, 'release-assets.json'), JSON.stringify(uploaded))
    expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', qualify], {
      cwd: assets, timeout: 10_000, stdio: 'pipe',
    })).toThrow('Uploaded release asset does not match qualified metadata')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
