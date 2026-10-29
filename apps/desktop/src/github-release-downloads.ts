/** Stable GitHub release checks with browser-owned installer downloads and no automatic installation. */
import { gt, valid } from 'semver'
import type { DesktopUpdateState } from './ipc.ts'

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('GitHub release metadata must be an object')
  return value as Record<string, unknown>
}

/**
 * Read the repository sealed into the app, retaining managed updates when absent.
 * @param manifest - Installed application manifest.
 * @returns Owner/repository, or undefined for the existing managed updater.
 */
export function desktopGithubRepository(manifest: unknown): string | undefined {
  const value = object(manifest).dshDesktopGithubRepository
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(value)) {
    throw new Error('Desktop GitHub updates require an owner/repository name')
  }
  return value
}

/** Owns one checked installer URL; product documents cannot supply download destinations. */
export class GithubReleaseDownloads {
  private current: DesktopUpdateState = { phase: 'idle' }
  private candidate: { version: string; url: string } | undefined
  private pending: Promise<DesktopUpdateState> | undefined
  private readonly abort = new AbortController()
  private disposed = false

  /**
   * @param repository - Validated installer-owned owner/repository.
   * @param currentVersion - Installed product version.
   * @param publish - Publish localized status through the existing update UI.
   * @param openDownload - Open a checked installer URL in the system browser.
   * @param request - Electron's network stack, replaceable for deterministic metadata tests.
   * @param platform - Installed app platform.
   * @param arch - Installed app architecture.
   */
  constructor(
    private readonly repository: string,
    private readonly currentVersion: string,
    private readonly publish: (state: DesktopUpdateState) => DesktopUpdateState,
    private readonly openDownload: (url: string) => Promise<void>,
    private readonly request: (url: string, init: { signal: AbortSignal }) => Promise<Response>,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly arch: string = process.arch,
  ) {}

  /** Latest checked state without exposing download URLs to the renderer. */
  get state(): DesktopUpdateState { return this.current }

  /**
   * Join metadata checks and retain visible failures only for explicit requests.
   * @param manual - Whether a check error must appear in the existing retry UI.
   * @returns Current stable availability, or a contained check failure.
   */
  async check(manual = false): Promise<DesktopUpdateState> {
    this.assertLive()
    this.pending ??= this.readLatest().finally(() => { this.pending = undefined })
    const result = await this.pending
    if (manual && result.phase === 'error' && !this.disposed) this.setState(result)
    return result
  }

  /**
   * Open the exact installer from the checked stable release; the browser owns transfer progress.
   * @param version - Version displayed in the download confirmation.
   * @returns Available state after opening, or a visible download failure; never installation readiness.
   */
  async download(version: string): Promise<DesktopUpdateState> {
    this.assertLive()
    await this.pending
    try {
      this.assertLive()
      if (this.candidate?.version !== version) throw new Error('The checked GitHub release has changed; check for updates again')
      await this.openDownload(this.candidate.url)
      return this.current
    } catch (error) {
      if (this.disposed) throw error
      return this.setState({ phase: 'error', version, failedOperation: 'download', message: String(error) })
    }
  }

  /**
   * Reject automatic installation for download-only distributions.
   * @param version - Requested release version.
   * @returns A visible installation failure without quitting or replacing the app.
   */
  install(version: string): Promise<DesktopUpdateState> {
    this.assertLive()
    return Promise.resolve(this.setState({ phase: 'error', version, failedOperation: 'install',
      message: 'Open the downloaded installer to update this application' }))
  }

  /** Cancel metadata reads and prevent late status publication. */
  dispose(): void { this.disposed = true; this.abort.abort() }

  private assertLive(): void {
    if (this.disposed) throw new Error('GitHub release checks are disposed')
  }

  private setState(state: DesktopUpdateState): DesktopUpdateState {
    this.assertLive()
    this.current = state
    return this.publish(state)
  }

  private async readLatest(): Promise<DesktopUpdateState> {
    try {
      const response = await this.request(`https://api.github.com/repos/${this.repository}/releases/latest`, {
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(30_000)]),
      })
      this.assertLive()
      if (response.status === 404) { this.candidate = undefined; return this.setState({ phase: 'idle' }) }
      if (!response.ok) throw new Error(`GitHub release check returned HTTP ${response.status}`)
      const text = await response.text()
      this.assertLive()
      if (Buffer.byteLength(text) > 1_048_576) throw new Error('GitHub release metadata exceeds the size limit')
      const parsed: unknown = JSON.parse(text)
      const release = object(parsed)
      const version = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/u, '') : ''
      if (release.tag_name !== `v${version}` || valid(version) !== version || version.includes('-') || version.includes('+') || release.draft !== false || release.prerelease !== false) {
        throw new Error('GitHub release must identify a published stable version')
      }
      if (!gt(version, this.currentVersion)) { this.candidate = undefined; return this.setState({ phase: 'idle' }) }
      const target = this.platform === 'darwin' ? 'mac' : this.platform === 'win32' ? 'win' : this.platform
      const extension = this.platform === 'darwin' ? 'dmg' : this.platform === 'win32' ? 'exe' : 'AppImage'
      const filename = `neurix-harness-${version}-${target}-${this.arch}-unsigned.${extension}`
      if (!Array.isArray(release.assets) || !release.assets.some((asset: unknown) => object(asset).name === filename)) {
        throw new Error(`GitHub release has no installer for ${target}-${this.arch}`)
      }
      this.candidate = { version, url: `https://github.com/${this.repository}/releases/download/v${version}/${filename}` }
      return this.setState({ phase: 'available', version })
    } catch (error) {
      return { phase: 'error', failedOperation: 'check', message: String(error) }
    }
  }
}
