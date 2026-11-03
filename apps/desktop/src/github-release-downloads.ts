/** Stable GitHub releases downloaded to a private cache and verified before installer handoff. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, mkdir, mkdtemp, open, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { gt, valid } from 'semver'
import type { DesktopUpdateState } from './ipc.ts'
import { DesktopUpdatePreparationError } from './update-error.ts'

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

/** Shell-owned network, cache, and platform actions; none are supplied by product documents. */
export interface GithubReleaseDownloadOptions {
  readonly directory: string
  readonly request: (url: string, init: { signal: AbortSignal }) => Promise<Response>
  readonly install: (file: string, version: string) => Promise<void>
  readonly beforeRestart: () => Promise<boolean>
  readonly installMode: 'restart' | 'installer'
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly metadataTimeoutMs: number
  readonly idleTimeoutMs: number
}

type Candidate = { version: string; filename: string; size: number; base: string }

/** Owns checked metadata, a cancellable transfer, and the verified local installer. */
export class GithubReleaseDownloads {
  private current: DesktopUpdateState = { phase: 'idle' }
  private candidate: Candidate | undefined
  private checking: Promise<DesktopUpdateState> | undefined
  private transfer: { controller: AbortController; done: Promise<DesktopUpdateState>; cancelled: boolean } | undefined
  private installing: Promise<DesktopUpdateState> | undefined
  private prepared: { file: string; sha256: string } | undefined
  private readonly lifetime = new AbortController()

  /**
   * @param repository - Installer-owned owner/repository.
   * @param currentVersion - Installed product version.
   * @param publish - Broadcast semantic state through the existing update UI.
   * @param options - Main-process-owned network, private cache, and installer actions.
   */
  constructor(
    private readonly repository: string,
    private readonly currentVersion: string,
    private readonly publish: (state: DesktopUpdateState) => DesktopUpdateState,
    private readonly options: GithubReleaseDownloadOptions,
  ) {}

  /** Latest checked state, without download destinations or local paths. */
  get state(): DesktopUpdateState { return this.current }

  /**
   * Join metadata checks without replacing a transfer or a verified installer.
   * @param manual - Whether a check failure remains visible for retry.
   * @returns Current availability, readiness, or a contained check failure.
   */
  async check(manual = false): Promise<DesktopUpdateState> {
    this.lifetime.signal.throwIfAborted()
    if (this.transfer !== undefined || this.installing !== undefined || this.prepared !== undefined) return this.current
    if (!manual && this.current.phase === 'error' && this.current.failedOperation === 'download') return this.current
    this.checking ??= this.readLatest().finally(() => { this.checking = undefined })
    const result = await this.checking
    if (manual && result.phase === 'error') this.setState(result)
    return result
  }

  /**
   * Download the checked release with byte progress and SHA-256 verification.
   * @param version - Exact checked version; URLs and paths remain main-process-owned.
   * @returns Ready, available after cancellation, or a visible retryable failure.
   */
  async download(version: string): Promise<DesktopUpdateState> {
    this.lifetime.signal.throwIfAborted()
    if (this.transfer !== undefined) return this.transfer.done
    if (this.prepared !== undefined || this.installing !== undefined) return this.current
    const controller = new AbortController()
    const done = Promise.resolve().then(async () => {
      await this.checking
      return this.downloadCandidate(version, controller)
    }).finally(() => { this.transfer = undefined })
    this.transfer = { controller, done, cancelled: false }
    return done
  }

  /** Stop the active transfer and await file cleanup before permitting another download. */
  async cancel(): Promise<void> {
    const transfer = this.transfer
    if (transfer === undefined || this.current.phase === 'verifying') return
    transfer.cancelled = true
    transfer.controller.abort()
    await transfer.done
  }

  /**
   * Reverify local bytes and hand off only after the shell's separate installation confirmation.
   * @param version - Version shown in the confirmation.
   * @returns Installation handoff, retained readiness on cancellation, or a visible failure.
   */
  async install(version: string): Promise<DesktopUpdateState> {
    this.lifetime.signal.throwIfAborted()
    this.installing ??= Promise.resolve().then(async () => {
      try {
        const prepared = this.prepared
        if (prepared === undefined || version !== this.candidate?.version || this.transfer !== undefined) {
          throw new Error('The checked installer is not ready')
        }
        const hash = createHash('sha256')
        await pipeline(createReadStream(prepared.file), new Writable({
          write(bytes: Buffer, _encoding, done) { hash.update(bytes); done() },
        }))
        if (hash.digest('hex') !== prepared.sha256) {
          this.prepared = undefined
          throw new Error('The local installer checksum changed; download the update again')
        }
        if (this.options.installMode === 'restart') this.setState({ phase: 'installing', version })
        if (this.options.installMode === 'restart' && !await this.options.beforeRestart()) return this.setState({ phase: 'ready', version })
        this.lifetime.signal.throwIfAborted()
        await this.options.install(prepared.file, version)
        return this.options.installMode === 'installer' ? this.setState({ phase: 'ready', version }) : this.current
      } catch (error) {
        return this.setState({ phase: 'error', version, failedOperation: this.prepared === undefined ? 'download' : 'install', message: String(error),
          ...(error instanceof DesktopUpdatePreparationError ? { preparationFailure: error.kind,
            ...(error.technicalDetails === undefined ? {} : { technicalDetails: error.technicalDetails }) } : {}) })
      }
    }).finally(() => { this.installing = undefined })
    return this.installing
  }

  /** Abort owned network work; pending transfer cleanup completes without publishing into disposed UI. */
  dispose(): void { this.lifetime.abort() }

  private setState(state: DesktopUpdateState): DesktopUpdateState {
    if (this.lifetime.signal.aborted) return state
    this.current = { ...state, installMode: this.options.installMode }
    return this.publish(this.current)
  }

  private async readLatest(): Promise<DesktopUpdateState> {
    try {
      const response = await this.options.request(`https://github.com/${this.repository}/releases/latest/download/desktop-update.json`, {
        signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(this.options.metadataTimeoutMs)]),
      })
      if (response.status === 404) { this.candidate = undefined; return this.setState({ phase: 'idle' }) }
      if (!response.ok) throw new Error(`GitHub release check returned HTTP ${response.status}`)
      const text = await response.text()
      this.lifetime.signal.throwIfAborted()
      if (Buffer.byteLength(text) > 1_048_576) throw new Error('GitHub release metadata exceeds the size limit')
      const release = object(JSON.parse(text))
      const version = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/u, '') : ''
      if (release.tag_name !== `v${version}` || valid(version) !== version || version.includes('-') || version.includes('+')
        || release.draft !== false || release.prerelease !== false) throw new Error('Expected a published stable GitHub release')
      if (!gt(version, this.currentVersion)) { this.candidate = undefined; return this.setState({ phase: 'idle' }) }
      const { platform, arch } = this.options
      const target = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform
      const extension = platform === 'darwin' ? 'dmg' : platform === 'win32' ? 'exe' : 'AppImage'
      const artifactArch = platform === 'linux' && arch === 'x64' ? 'x86_64' : arch
      const filename = `neurix-harness-${version}-${target}-${artifactArch}-unsigned.${extension}`
      if (!Array.isArray(release.assets)) throw new Error('Release assets are missing')
      const assets = release.assets.map((asset: unknown) => object(asset))
      const asset = assets.find(item => item.name === filename)
      if (asset === undefined || !assets.some(item => item.name === 'SHA256SUMS.txt')
        || typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 4_294_967_296) {
        throw new Error(`Release has no complete installer and checksums for ${target}-${arch}`)
      }
      this.candidate = { version, filename, size: asset.size, base: `https://github.com/${this.repository}/releases/download/v${version}/` }
      return this.setState({ phase: 'available', version })
    } catch (error) {
      return { phase: 'error', failedOperation: 'check', message: String(error) }
    }
  }

  private async downloadCandidate(version: string, controller: AbortController): Promise<DesktopUpdateState> {
    let temporary: string | undefined
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let idle: ReturnType<typeof setTimeout> | undefined
    const signal = AbortSignal.any([controller.signal, this.lifetime.signal])
    const refresh = (): void => {
      clearTimeout(idle)
      idle = setTimeout(() => { controller.abort(new Error('Update download timed out')) }, this.options.idleTimeoutMs)
    }
    let outcome: DesktopUpdateState
    try {
      signal.throwIfAborted()
      const candidate = this.candidate
      if (candidate?.version !== version) throw new Error('The checked GitHub release changed; check for updates again')
      this.setState({ phase: 'downloading', version, percent: 0, canCancel: true })
      refresh()
      const checksums = await this.options.request(candidate.base + 'SHA256SUMS.txt', { signal })
      if (!checksums.ok) throw new Error(`Checksum download returned HTTP ${checksums.status}`)
      const checksumText = await checksums.text()
      if (Buffer.byteLength(checksumText) > 131_072) throw new Error('Checksum list exceeds its size limit')
      const matches = checksumText.split('\n').flatMap((line) => {
        const match = /^([a-fA-F0-9]{64}) [ *](.+)$/u.exec(line)
        return match?.[2] === candidate.filename && match[1] !== undefined ? [match[1].toLowerCase()] : []
      })
      const expected = matches[0]
      if (matches.length !== 1 || expected === undefined) throw new Error('Installer SHA-256 checksum is missing or ambiguous')
      refresh()
      const response = await this.options.request(candidate.base + candidate.filename, { signal })
      if (!response.ok || response.body === null) throw new Error(`Installer download returned HTTP ${response.status}`)
      await mkdir(this.options.directory, { recursive: true, mode: 0o700 })
      temporary = await mkdtemp(join(this.options.directory, '.download-'))
      const partial = join(temporary, candidate.filename)
      const file = await open(partial, 'wx', 0o600)
      reader = response.body.getReader()
      let received = 0
      let previousPercent = 0
      const hash = createHash('sha256')
      try {
        while (true) {
          signal.throwIfAborted()
          const chunk = await reader.read()
          if (chunk.done) break
          refresh()
          received += chunk.value.byteLength
          if (received > candidate.size) throw new Error('Installer exceeds the release asset size')
          hash.update(chunk.value)
          await file.writeFile(chunk.value)
          const percent = Math.min(99, Math.floor(received / candidate.size * 100))
          if (percent !== previousPercent) {
            previousPercent = percent
            this.setState({ phase: 'downloading', version, percent, canCancel: true })
          }
        }
        signal.throwIfAborted()
        this.setState({ phase: 'verifying', version, percent: 100 })
        if (received !== candidate.size || hash.digest('hex') !== expected) throw new Error('Installer size or SHA-256 verification failed')
        await file.sync()
      } finally { await file.close() }
      const destination = join(this.options.directory, candidate.filename)
      if (this.options.platform === 'linux') await chmod(partial, 0o700)
      await rename(partial, destination)
      this.prepared = { file: destination, sha256: expected }
      outcome = { phase: 'ready', version }
    } catch (error) {
      outcome = this.transfer?.cancelled === true ? { phase: 'available', version }
        : { phase: 'error', version, failedOperation: 'download', message: String(error) }
    } finally {
      clearTimeout(idle)
      if (reader !== undefined) {
        try { await reader.cancel() } catch (_error) { /* Aborted network streams can already be closed. */ }
        reader.releaseLock()
      }
      if (temporary !== undefined) {
        try { await rm(temporary, { recursive: true, force: true }) }
        catch (error) {
          this.prepared = undefined
          outcome = { phase: 'error', version, failedOperation: 'download', message: `Download cleanup failed: ${String(error)}` }
        }
      }
    }
    return this.setState(outcome)
  }
}
