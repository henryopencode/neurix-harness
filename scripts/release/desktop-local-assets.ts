/** Collect tested platform outputs and verify their bytes after transfer to the release host. */
import { createHash } from 'node:crypto'
import { constants, copyFileSync, createReadStream, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { StableDesktopRelease } from './desktop-stable.ts'

/** Platform builds required by the Desktop and Linux server updaters. */
export const desktopReleaseTargets = ['win-x64', 'mac-arm64', 'mac-x64', 'linux-x64'] as const

/** A target that produces one platform's part of a stable Desktop release. */
export type DesktopReleaseTarget = typeof desktopReleaseTargets[number]

const suffixes: Readonly<Record<DesktopReleaseTarget, readonly string[]>> = {
  'win-x64': ['win-x64-unsigned.exe'],
  'mac-arm64': ['mac-arm64-unsigned.dmg'],
  'mac-x64': ['mac-x64-unsigned.dmg'],
  'linux-x64': ['linux-x86_64-unsigned.AppImage', 'linux-x64-server.tar.gz'],
}
const assetFields = z.object({ name: z.string(), size: z.int().positive(), sha256: z.string().regex(/^[0-9a-f]{64}$/u) })
const receipt = z.object({ commit: z.string(), tag: z.string(), assets: z.array(assetFields) })

/** File identity shared by the checksum list, update metadata, and GitHub verification. */
export interface DesktopReleaseAsset extends z.infer<typeof assetFields> {
  readonly path: string
}

function names(release: StableDesktopRelease, target: DesktopReleaseTarget): string[] {
  return suffixes[target].map(suffix => `neurix-harness-${release.version}-${suffix}`)
}

/**
 * Measure a nonempty file without loading the installer into memory.
 * @param directory - Directory containing the file.
 * @param name - Asset filename.
 * @returns Size and SHA-256 of the bytes read from disk.
 */
export async function measureDesktopReleaseAsset(directory: string, name: string): Promise<DesktopReleaseAsset> {
  const path = join(directory, name)
  if (!lstatSync(path).isFile()) throw new Error(`Expected a regular release file: ${path}`)
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
    hash.update(chunk)
    size += chunk.length
  }
  if (size === 0) throw new Error(`Empty release asset: ${path}`)
  return { path, name, size, sha256: hash.digest('hex') }
}

/**
 * Copy one tested platform build into a new directory with its commit and checksums.
 * @param release - Reservation used for this build.
 * @param target - Platform just built and tested by the caller.
 * @param buildDirectory - Packaging output directory.
 * @param directory - Parent for the platform directories.
 * @returns The completed platform directory. A failed copy leaves no qualified build.
 */
export async function recordDesktopReleaseBuild(
  release: StableDesktopRelease,
  target: DesktopReleaseTarget,
  buildDirectory: string,
  directory: string,
): Promise<string> {
  mkdirSync(directory, { recursive: true })
  const output = join(directory, target)
  const staging = mkdtempSync(join(directory, `.${target}-`))
  try {
    const assets = []
    for (const name of names(release, target)) {
      copyFileSync(join(buildDirectory, name), join(staging, name), constants.COPYFILE_EXCL)
      const { size, sha256 } = await measureDesktopReleaseAsset(staging, name)
      assets.push({ name, size, sha256 })
    }
    writeFileSync(join(staging, 'build.json'), `${JSON.stringify({ commit: release.commit, tag: release.tag, assets })}\n`)
    renameSync(staging, output)
    return output
  } finally {
    rmSync(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

/**
 * Verify all required platform outputs match one reservation and their build receipts.
 * @param release - Reservation to publish.
 * @param directory - Parent containing the transferred platform directories.
 * @returns The full installer and server archive set.
 * @throws On a missing, mixed, or damaged build.
 */
export async function readDesktopReleaseBuilds(release: StableDesktopRelease, directory: string): Promise<DesktopReleaseAsset[]> {
  const assets: DesktopReleaseAsset[] = []
  for (const target of desktopReleaseTargets) {
    const platform = join(directory, target)
    const path = join(platform, 'build.json')
    const record = receipt.parse(JSON.parse(readFileSync(path, 'utf8')))
    if (record.commit !== release.commit || record.tag !== release.tag) {
      throw new Error(`${target} was not built from ${release.tag} at ${release.commit}`)
    }
    const expected = names(release, target)
    if (record.assets.length !== expected.length) throw new Error(`Incomplete build receipt: ${path}`)
    for (const name of expected) {
      const asset = await measureDesktopReleaseAsset(platform, name)
      const recorded = record.assets.find(item => item.name === name)
      if (recorded?.size !== asset.size || recorded.sha256 !== asset.sha256) throw new Error(`Build checksum mismatch: ${asset.path}`)
      assets.push(asset)
    }
  }
  return assets
}
