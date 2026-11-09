/** Resolve alternate downloads from one version-bound GitHub release, without trusting response URLs. */
import type { GithubReleaseRequest } from './github-release-transfer.ts'
import { readGithubReleaseText } from './github-release-network.ts'

/** One user download owns its release lookup; range requests never repeat API discovery. */
export class GithubReleaseAssets {
  private release: Promise<readonly Record<string, unknown>[]> | undefined

  /**
   * @param repository - Installer-owned owner/repository.
   * @param version - Stable version already selected by the public update metadata.
   * @param request - Proxy-preserving shell transport.
   * @param signal - Cancellation shared with the user download.
   * @param timeoutMs - Total deadline for each bounded metadata operation.
   */
  constructor(private readonly repository: string, private readonly version: string,
    private readonly request: GithubReleaseRequest, private readonly signal: AbortSignal, private readonly timeoutMs: number) {}

  /**
   * @param filename - Exact checked installer or checksum asset name.
   * @param expectedSize - Checked installer size; omitted for the bounded checksum text.
   * @returns An asset API URL constructed from this repository and a validated asset id.
   * @throws On lookup failure, changed release identity, duplicate assets, or mismatched installer size.
   */
  async url(filename: string, expectedSize?: number): Promise<string> {
    this.release ??= this.read()
    const matches = (await this.release).filter(asset => asset.name === filename)
    const asset = matches[0]
    if (matches.length !== 1 || asset === undefined || typeof asset.id !== 'number' || !Number.isSafeInteger(asset.id)
      || asset.id <= 0 || typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size <= 0
      || (expectedSize !== undefined && asset.size !== expectedSize)) throw new Error('GitHub fallback asset is missing or changed')
    return `https://api.github.com/repos/${this.repository}/releases/assets/${asset.id}`
  }

  private async read(): Promise<readonly Record<string, unknown>[]> {
    const text = await readGithubReleaseText({ request: this.request,
      url: `https://api.github.com/repos/${this.repository}/releases/tags/v${this.version}`,
      signal: this.signal, timeoutMs: this.timeoutMs, maxBytes: 1_048_576, label: 'GitHub asset lookup',
      headers: { Accept: 'application/vnd.github+json' } })
    const value: unknown = JSON.parse(text ?? '')
    if (typeof value !== 'object' || value === null || !('tag_name' in value) || value.tag_name !== `v${this.version}`
      || !('draft' in value) || value.draft !== false || !('prerelease' in value) || value.prerelease !== false
      || !('assets' in value) || !Array.isArray(value.assets)) throw new Error('GitHub fallback release identity changed')
    return value.assets.map((asset: unknown) => {
      if (typeof asset !== 'object' || asset === null || Array.isArray(asset)) throw new Error('GitHub fallback asset is invalid')
      return asset as Record<string, unknown>
    })
  }
}
