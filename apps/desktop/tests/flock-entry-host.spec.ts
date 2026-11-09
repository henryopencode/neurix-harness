import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  binaries: [] as { tool: string; path: string; libc?: string }[],
  exists: new Set<string>(),
  tryLockExclusive: vi.fn(),
}))
vi.mock('node:fs', () => ({
  existsSync: (path: string) => fixture.exists.has(path),
  readFileSync: () => JSON.stringify({ binaries: fixture.binaries }),
}))
vi.mock('node:module', () => ({ createRequire: () => ({
  resolve: (request: string) => join('native-builds', request.endsWith('/prebuilds.json') ? 'prebuilds.json' : 'package.json'),
}) }))
vi.mock('@deepseek-ai/node-addon-system/flock', () => ({ tryLockExclusive: fixture.tryLockExclusive }))

beforeEach(() => {
  vi.resetModules()
  fixture.exists.clear()
  fixture.binaries = [
    { tool: 'landlock-run', path: 'bin/landlock-run' },
    { tool: 'flock', path: 'bin/glibc/system.node', libc: 'glibc' },
    { tool: 'flock', path: 'bin/musl/system.node', libc: 'musl' },
  ]
  vi.stubEnv('npm_execpath', '')
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

function host(platform: string, glibc: boolean) {
  vi.stubGlobal('process', { ...process, platform, arch: 'x64', report: {
    getReport: () => ({ header: glibc ? { glibcVersionRuntime: '2.39' } : {} }),
  } })
}

it.each(['glibc', 'musl'])('loads the available %s flock without requiring other Linux binaries', async (libc) => {
  host('linux', libc === 'glibc')
  fixture.exists.add(join('native-builds', 'bin', libc, 'system.node'))
  const { loadFlockEntry } = await import('../scripts/flock-entry.ts')
  expect(await loadFlockEntry()).toMatchObject({ tryLockExclusive: fixture.tryLockExclusive })
})

it.each(['glibc', 'musl'])('requires the running %s flock even when the other libc is built', async (libc) => {
  host('linux', libc === 'glibc')
  fixture.exists.add(join('native-builds', 'bin', libc === 'glibc' ? 'musl' : 'glibc', 'system.node'))
  const { loadFlockEntry } = await import('../scripts/flock-entry.ts')
  await expect(loadFlockEntry()).rejects.toThrow('flock addon is not built')
})

it('loads the macOS flock without requiring other tools', async () => {
  host('darwin', false)
  fixture.binaries = [{ tool: 'flock', path: 'bin/system.node' }, { tool: 'other', path: 'bin/other' }]
  fixture.exists.add(join('native-builds', 'bin', 'system.node'))
  const { loadFlockEntry } = await import('../scripts/flock-entry.ts')
  expect(await loadFlockEntry()).toMatchObject({ tryLockExclusive: fixture.tryLockExclusive })
})

it('does not treat an unrelated built tool as a usable flock', async () => {
  host('linux', true)
  fixture.binaries = [{ tool: 'landlock-run', path: 'bin/landlock-run' }]
  fixture.exists.add(join('native-builds', 'bin', 'landlock-run'))
  const { loadFlockEntry } = await import('../scripts/flock-entry.ts')
  await expect(loadFlockEntry()).rejects.toThrow('flock addon is not built')
})
