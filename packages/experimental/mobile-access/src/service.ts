/** Explicit network admission to the same running application. @module */
import { networkInterfaces } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { WebListener } from '@deepseek-ai/dsh-host-webserver'
import QRCode from 'qrcode'
import type { ResolvedConfig } from './index.ts'
import type { MobileNetwork, MobileAccessState } from './types.ts'
import type {} from './account.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Owner-controlled phone access to this application's existing sessions. */
    mobileAccess: MobileAccess
  }
}

function networks(): MobileNetwork[] {
  return Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
    (addresses ?? []).filter(address => !address.internal && address.family === 'IPv4')
      .map(address => ({ name, host: address.address })))
}

/** Serialized owner actions; every listener belongs to this exact activation. */
export class MobileAccess extends TypertRemoteService {
  static inject = ['webServer', 'connection', 'typert', 'neurixAccount']
  private tail: Promise<void> = Promise.resolve()
  private stopped = false
  private active: {
    listener: WebListener
    withdraw: () => Promise<void>
    connection: NonNullable<MobileAccessState['connection']>
  } | undefined

  constructor(private readonly owner: Context, private readonly config: ResolvedConfig) {
    super(owner, 'mobileAccess', { namespace: 'mobileAccess' })
    owner.effect(() => async () => {
      this.stopped = true
      await this.tail
      await this.release()
    }, 'mobile-access: shutdown')
    owner.on('neurix-account/changed', (state) => {
      if (!this.config.autoConnect || this.stopped) return
      const operation = state.signedIn ? this.open('127.0.0.1', new AbortController().signal) : this.close()
      void operation.catch((error: unknown) => { owner.logger.error('Could not update internet phone access', error) })
    })
  }

  /** Restore an explicitly enabled internet listener after the computer restarts. */
  async [Service.init](): Promise<void> {
    if (!this.config.autoConnect || !this.owner.neurixAccount.describe().signedIn) return
    try { await this.open('127.0.0.1', new AbortController().signal) }
    catch (error) { this.owner.logger.error('Could not restore internet phone access', error) }
  }

  /**
   * Read current network choices and private connection details.
   * @returns current interfaces and any active owner's connection link and QR code.
   */
  @Remote
  describe(): MobileAccessState {
    return { mode: this.config.publicUrl === undefined ? 'lan' : 'internet',
      networks: this.config.publicUrl === undefined ? networks() : [], account: this.owner.neurixAccount.describe(),
      ...this.active === undefined ? {} : { connection: this.active.connection } }
  }

  /**
   * Serve this Host's existing sessions on a selected current network.
   * @param host - IPv4 address returned by describe().networks.
   * @param signal - cancellation before publication closes the acquired listener.
   * @returns the authenticated launch URL and QR code, after successful binding.
   */
  @Remote
  open(host: string, signal: AbortSignal): Promise<MobileAccessState> {
    return this.enqueue(async () => {
      signal.throwIfAborted()
      if (!this.owner.neurixAccount.describe().signedIn) {
        throw new RemoteError('neurix-account/sign-in-required', 'Sign in to Neurix on this computer first', {})
      }
      const internet = this.config.publicUrl !== undefined
      if (internet ? host !== '127.0.0.1' : !networks().some(network => network.host === host)) {
        throw new RemoteError('mobile-access/network-unavailable', 'Select an available network and retry', {})
      }
      if (this.active !== undefined && new URL(this.active.listener.origin).hostname === host) return this.describe()
      await this.release()
      const listener = await this.owner.webServer.listen({ host, port: this.config.port })
      let withdraw: (() => Promise<void>) | undefined
      try {
        signal.throwIfAborted()
        const url = this.config.publicUrl ?? listener.origin + '/'
        const authority = new URL(url).host
        const untrust = this.owner.connection.registerTrustedHost(authority)
        const unauth = this.owner.neurixAccount.allowHost(authority, internet)
        withdraw = async () => { await untrust(); await unauth() }
        const qrCode = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 256 })
        signal.throwIfAborted()
        if (this.stopped) throw new RemoteError('mobile-access/closing', 'The phone connection is closing', {})
        this.active = { listener, withdraw, connection: { url, qrCode, encrypted: url.startsWith('https:') } }
        return this.describe()
      } catch (error) {
        try { await withdraw?.() } finally { await listener.close() }
        throw error
      }
    })
  }

  /**
   * Disconnect phones while retaining this Host and every Agent task.
   * @returns state after trust withdrawal and quiescent socket closure.
   */
  @Remote
  close(): Promise<MobileAccessState> {
    return this.enqueue(async () => { await this.release(); return this.describe() })
  }

  private enqueue(operation: () => Promise<MobileAccessState>): Promise<MobileAccessState> {
    const task = this.tail.then(() => {
      if (this.stopped) throw new RemoteError('mobile-access/closing', 'The phone connection is closing', {})
      return operation()
    })
    this.tail = task.then(() => {}, () => {})
    return task
  }

  private async release(): Promise<void> {
    const active = this.active
    this.active = undefined
    if (active === undefined) return
    try { await active.withdraw() } finally { await active.listener.close() }
  }
}
