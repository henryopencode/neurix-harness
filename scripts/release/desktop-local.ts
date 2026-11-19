/** Local entry point for stable Desktop releases on separate platform build hosts. */
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { desktopTargetBuildPaths } from '../../apps/desktop/scripts/desktop-build-paths.mjs'
import { desktopReleaseTargets, recordDesktopReleaseBuild, type DesktopReleaseTarget } from './desktop-local-assets.ts'
import { submitLocalDesktopRelease } from './desktop-local-github.ts'
import { readReservedDesktopRelease } from './desktop-reserved.ts'
import { reserveLocalDesktopRelease, type StableDesktopRelease } from './desktop-stable.ts'
import { capture, pnpmCommand, runConcurrent } from './process.ts'

const cwd = process.cwd()
const git = (...args: string[]) => capture('git', args)
const releaseOptions = { tag: { type: 'string' }, assets: { type: 'string' } } as const
const help = `Usage: pnpm release:desktop <command>

  reserve [--version <x.y.z>]                         Push a version commit and tags from detached origin/master.
  build --tag <vX.Y.Z> --target <target> --assets <dir>  Test and collect one platform build.
  draft --tag <vX.Y.Z> --assets <dir>                  Upload the verified builds to a GitHub draft.
  publish --tag <vX.Y.Z> --assets <dir>                Recheck the draft and make it public.

Targets: ${desktopReleaseTargets.join(', ')}.
Use the same reserved tag on all build hosts. Keep the assets directory outside the checkout.
See docs/releasing.md for the release SOP.`

function required(value: string | undefined, option: string): string {
  if (value === undefined || value.trim() === '') throw new Error(`--${option} is required`)
  return value
}

function releaseRepository(): string {
  const manifest = z.object({ dshDesktopGithubRepository: z.string().regex(/^[\w-]+\/[\w.-]+$/u) })
    .parse(JSON.parse(readFileSync(join(cwd, 'apps/desktop/package.json'), 'utf8')))
  const repo = manifest.dshDesktopGithubRepository
  const urls = [`https://github.com/${repo}`, `git@github.com:${repo}`, `ssh://git@github.com/${repo}`]
    .flatMap(url => [url.toLowerCase(), `${url.toLowerCase()}.git`])
  if (!urls.includes(git('remote', 'get-url', 'origin').toLowerCase())
    || !urls.includes(git('remote', 'get-url', '--push', '--all', 'origin').toLowerCase())) {
    throw new Error(`The fetch and push URLs for origin must identify github.com/${repo}`)
  }
  return repo
}

function assertRemoteReservation(release: StableDesktopRelease): void {
  const tags = [`refs/tags/${release.tag}`, `refs/tags/dsh-${release.tag}`]
  const lines = git('ls-remote', '--exit-code', 'origin', ...tags, ...tags.map(tag => `${tag}^{}`)).split('\n')
  for (const tag of tags) {
    const resolved = lines.find(line => line.endsWith(`\t${tag}^{}`)) ?? lines.find(line => line.endsWith(`\t${tag}`))
    if (resolved?.split('\t')[0] !== release.commit) {
      throw new Error(`Remote ${tag} does not identify ${release.commit}. Fetch and inspect the reservation.`)
    }
  }
}

function requireCleanCheckout(): void {
  if (git('status', '--porcelain') !== '') throw new Error('Use a clean Desktop release checkout')
}

async function pnpm(...args: string[]): Promise<void> {
  const [command, ...prefix] = pnpmCommand()
  await runConcurrent(command, [...prefix, ...args], { cwd })
}

async function build(tag: string, target: DesktopReleaseTarget, directory: string): Promise<void> {
  requireCleanCheckout()
  const release = readReservedDesktopRelease(cwd, tag)
  if (git('rev-parse', 'HEAD') !== release.commit) throw new Error(`Check out ${tag} before building ${target}`)
  const fromCheckout = relative(cwd, directory)
  if (!isAbsolute(fromCheckout) && fromCheckout !== '..' && !fromCheckout.startsWith(`..${sep}`)) {
    throw new Error('Put --assets outside the release checkout')
  }
  if (existsSync(join(directory, target))) throw new Error(`A build already exists in ${join(directory, target)}. Use a fresh --assets location.`)

  await pnpm('--dir', 'apps/desktop', 'exec', 'tsx', 'scripts/package-target.ts', target, '--unsigned')
  await pnpm('exec', 'vitest', 'run',
    'apps/desktop/tests/github-release-downloads.spec.ts', 'apps/desktop/tests/github-release-installer.spec.ts',
    'apps/desktop/tests/github-release-replacement.spec.ts', 'apps/desktop/tests/update-schedule.spec.ts',
    'apps/desktop/tests/update-coordinator.spec.ts')
  if (target === 'linux-x64') {
    await runConcurrent('python3', ['-B', '-m', 'unittest', 'scripts/deploy/test_server_update.py'], { cwd })
    await runConcurrent(process.execPath, ['--test', 'scripts/deploy/server-update-control.test.mjs'], { cwd })
    await runConcurrent(process.execPath, ['scripts/release/package-linux-server.mjs'], { cwd })
  }
  requireCleanCheckout()
  if (git('rev-parse', 'HEAD') !== release.commit) throw new Error('The release checkout changed during the build')
  const output = await recordDesktopReleaseBuild(release, target, desktopTargetBuildPaths(target).unsignedArtifacts, directory)
  console.log(`${release.tag} ${target} is ready: ${output}`)
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args
  switch (command) {
    case undefined:
    case '--help':
      console.log(help)
      return
    case 'reserve': {
      const { values } = parseArgs({ args: rest, options: { version: { type: 'string' } } })
      requireCleanCheckout()
      releaseRepository()
      await pnpm('run', 'verify-default-product-isolation')
      const release = reserveLocalDesktopRelease(values.version)
      assertRemoteReservation(release)
      console.log(`Reserved ${release.tag} at ${release.commit}`)
      return
    }
    case 'build': {
      const { values } = parseArgs({ args: rest, options: { ...releaseOptions, target: { type: 'string' } } })
      const target = desktopReleaseTargets.find(value => value === values.target)
      if (target === undefined) throw new Error(`Select --target from ${desktopReleaseTargets.join(', ')}`)
      await build(required(values.tag, 'tag'), target, resolve(required(values.assets, 'assets')))
      return
    }
    case 'draft':
    case 'publish': {
      const { values } = parseArgs({ args: rest, options: releaseOptions })
      const tag = required(values.tag, 'tag')
      const directory = resolve(required(values.assets, 'assets'))
      requireCleanCheckout()
      const repo = releaseRepository()
      git('fetch', 'origin', 'master', '--tags')
      const release = readReservedDesktopRelease(cwd, tag)
      assertRemoteReservation(release)
      const url = await submitLocalDesktopRelease(
        args => capture('gh', args[0] === 'api' ? [...args, '--hostname', 'github.com'] : args),
        repo, release, directory, command,
      )
      console.log(command === 'draft' ? `Verified draft: ${url}\nReview the draft before running publish.` : `Verified published Release: ${url}`)
      return
    }
    default:
      throw new Error(`Unknown command ${command}. Run pnpm release:desktop --help.`)
  }
}

await main(process.argv.slice(2)).catch((error: unknown) => {
  console.error('Desktop release:', error instanceof Error ? error.message : error)
  if (error instanceof Error && error.cause instanceof Error) console.error(error.cause.message)
  process.exitCode = 1
})
