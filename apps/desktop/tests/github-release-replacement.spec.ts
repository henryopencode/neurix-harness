/** Real application entries and a detached worker, isolated from installed applications. */
import { fork, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { parseGithubReleaseReplacement, recordGithubReleaseFailure, replaceGithubRelease, verifyGithubReleaseReplacement, waitForGithubReleaseExit, type GithubReleaseReplacement } from '../src/github-release-replacement.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture(platform: 'darwin' | 'linux' = 'linux') {
  const directory = await mkdtemp(join(tmpdir(), 'neurix-replacement-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const staging = join(directory, 'staging')
  await mkdir(staging)
  const plan: GithubReleaseReplacement = { platform, version: '1.0.1', parentPid: process.pid,
    installed: join(directory, 'Neurix Harness'), prepared: join(staging, 'next'), backup: join(staging, 'previous'), resultFile: join(directory, 'result.json') }
  if (platform === 'darwin') {
    await mkdir(plan.installed); await mkdir(plan.prepared)
    await writeFile(join(plan.installed, 'version'), 'old'); await writeFile(join(plan.prepared, 'version'), 'new')
  } else {
    await writeFile(plan.installed, 'old'); await writeFile(plan.prepared, 'new')
  }
  return { directory, plan }
}

it.each(['darwin', 'linux'] as const)('replaces the %s application and retains its previous bytes', async (platform) => {
  const { plan } = await fixture(platform)
  expect(parseGithubReleaseReplacement(JSON.parse(JSON.stringify(plan)))).toEqual(plan)
  await replaceGithubRelease(plan, async (file) => {
    expect(await readFile(platform === 'darwin' ? join(file, 'version') : file, 'utf8')).toBe('new')
  })
  expect(await readFile(platform === 'darwin' ? join(plan.backup, 'version') : plan.backup, 'utf8')).toBe('old')
})

it('restores old bytes when the operating system rejects the replacement launch', async () => {
  const { plan } = await fixture()
  await expect(replaceGithubRelease(plan, async () => { throw new Error('launch denied') })).rejects.toThrow('launch denied')
  expect(await readFile(plan.installed, 'utf8')).toBe('old')
  expect(await readFile(plan.prepared, 'utf8')).toBe('new')
})

it('refuses an existing backup and leaves both apps untouched', async () => {
  const { plan } = await fixture()
  await writeFile(plan.backup, 'retained')
  await expect(verifyGithubReleaseReplacement(plan)).rejects.toThrow('backup already exists')
  expect(await readFile(plan.installed, 'utf8')).toBe('old')
  expect(await readFile(plan.backup, 'utf8')).toBe('retained')
})

it('records a complete failure for the next application launch and refuses malformed worker paths', async () => {
  const { plan } = await fixture()
  await recordGithubReleaseFailure(plan, new Error('launch denied'))
  expect(JSON.parse(await readFile(plan.resultFile, 'utf8'))).toEqual({ status: 'error', version: '1.0.1', message: 'Error: launch denied' })
  for (const invalid of [null, { ...plan, parentPid: 0 }, { ...plan, platform: 'win32' }, { ...plan, installed: 'relative' },
    { ...plan, prepared: plan.installed }, { ...plan, backup: plan.prepared }, { ...plan, resultFile: '\0' }]) {
    expect(() => parseGithubReleaseReplacement(invalid)).toThrow()
  }
})

it('times out while the owner is alive without changing its application', async () => {
  const { plan } = await fixture()
  await expect(waitForGithubReleaseExit(process.pid, 10)).rejects.toThrow('did not exit')
  expect(await readFile(plan.installed, 'utf8')).toBe('old')
})

async function ownChild(child: ChildProcess): Promise<ChildProcess> {
  let exited = child.exitCode !== null || child.signalCode !== null
  const completed = new Promise<void>((resolve) => { child.once('exit', () => { exited = true; resolve() }) })
  cleanups.push(async () => {
    if (!exited) { child.kill(); await completed }
    child.stdout?.destroy(); child.stderr?.destroy()
    if (child.connected) child.disconnect()
  })
  return child
}

it.skipIf(process.platform === 'win32')('runs the real worker only after owner exit and launches the replacement from a path containing spaces', async () => {
  const { plan, directory } = await fixture()
  const owner = await ownChild(spawn(process.execPath, ['-e', 'process.send("ready"); setInterval(() => {}, 1000)'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }))
  await once(owner, 'message')
  const marker = join(directory, 'launched')
  await writeFile(plan.prepared, '#!/bin/sh\nprintf new > "$(dirname "$0")/launched"\n')
  await chmod(plan.prepared, 0o755)
  const worker = await ownChild(fork(fileURLToPath(new URL('../src/github-release-worker.ts', import.meta.url)), [JSON.stringify({ ...plan, parentPid: owner.pid })], {
    execArgv: ['--import', 'tsx/esm'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  }))
  let output = ''
  worker.stderr?.on('data', (bytes: Buffer) => { output += bytes.toString() })
  expect((await once(worker, 'message'))[0], output).toBe('ready')
  const completed = once(worker, 'exit')
  worker.disconnect()
  expect(await readFile(plan.installed, 'utf8')).toBe('old')
  const ownerExited = once(owner, 'exit')
  owner.kill()
  await ownerExited
  expect(await completed, output).toEqual([0, null])
  await vi.waitFor(async () => { expect(await readFile(marker, 'utf8')).toBe('new') })
  expect(await readFile(plan.backup, 'utf8')).toBe('old')
})
