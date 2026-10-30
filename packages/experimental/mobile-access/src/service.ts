/** Explicit network admission to the same running application. @module */
import { networkInterfaces } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { WebListener } from '@deepseek-ai/dsh-host-webserver'
import QRCode from 'qrcode'
import type { ResolvedConfig } from './index.ts'
import type { LinkStore } from './link-store.ts'
import type { MobileNetwork, MobileAccessState } from './types.ts'
import type {} from './phone-sessions.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Computer-controlled phone access to this application's existing sessions. */
    mobileAccess: MobileAccess
  }
}

function networks(): MobileNetwork[] {
  return Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
    (addresses ?? []).filter(address => !address.internal && address.family === 'IPv4')
      .map(address => ({ name, host: address.address })))
}

/** Serialized connection actions; credentials and listeners belong to this activation. */
export class MobileAccess extends TypertRemoteService {
  static inject = ['webServer', 'connection', 'typert', 'phoneSessions']
  private tail: Promise<void> = Promise.resolve()
  private stopped = false
  private readonly watchers = new Set<() => void>()
  private active: {
    listener: WebListener
    withdraw: () => Promise<void>
    connection: NonNullable<MobileAccessState['connection']>
  } | undefined

  constructor(private readonly owner: Context, private readonly options: { config: ResolvedConfig; store: LinkStore }) {
    super(owner, 'mobileAccess', { namespace: 'mobileAccess' })
    owner.effect(() => async () => {
      this.stopped = true
      this.notify()
      await this.tail
      await this.release()
    }, 'mobile-access: shutdown')
  }

  /** Restore the owner's saved internet switch without requiring an account or changing its link. */
  async [Service.init](): Promise<void> {
    if (this.options.config.publicUrl === undefined || !(this.options.store.enabled ?? this.options.config.autoConnect)) return
    try { await this.open('127.0.0.1', new AbortController().signal) }
    catch (error) { this.owner.logger.error('Could not restore internet phone access; retry in Phone connection', error) }
  }

  /**
   * Read network choices and the computer's private link; phone callers receive no link credential.
   * @returns role-specific connection state.
   */
  @Remote
  describe(): MobileAccessState {
    return this.snapshot(this.owner.phoneSessions.isPhone(this.ctx.invocation?.peer))
  }

  /**
   * Follow connection changes without polling or creating another Agent.
   * @param signal - ends this caller's subscription.
   * @returns current state followed by committed connection changes.
   */
  @Remote({ mode: 'stream' })
  async *watch(signal: AbortSignal): AsyncIterable<MobileAccessState> {
    const phone = this.owner.phoneSessions.isPhone(this.ctx.invocation?.peer)
    let wake = Promise.withResolvers<void>()
    const changed = () => { wake.resolve() }
    this.watchers.add(changed)
    signal.addEventListener('abort', changed, { once: true })
    try {
      while (!signal.aborted && !this.stopped) {
        const pending = wake.promise
        yield this.snapshot(phone)
        await pending
        wake = Promise.withResolvers<void>()
      }
    } finally {
      signal.removeEventListener('abort', changed)
      this.watchers.delete(changed)
    }
  }

  /**
   * Enable access with the saved link, creating a secret only on first use.
   * @param host - current IPv4 interface, or loopback for configured internet access.
   * @param signal - cancellation before credential commit releases the candidate listener.
   * @returns the same-Host link and QR code after successful binding and persistence.
   */
  @Remote
  open(host: string, signal: AbortSignal): Promise<MobileAccessState> {
    this.requireComputer()
    return this.enqueue(async () => {
      signal.throwIfAborted()
      const { config, store } = this.options
      const internet = config.publicUrl !== undefined
      if (internet ? host !== '127.0.0.1' : !networks().some(network => network.host === host)) {
        throw new RemoteError('mobile-access/network-unavailable', 'Select an available network and retry', {})
      }
      if (this.active !== undefined && new URL(this.active.listener.origin).hostname === host) return this.describe()
      await this.release()
      const listener = await this.owner.webServer.listen({ host, port: config.port })
      let withdraw: (() => Promise<void>) | undefined
      try {
        const token = store.token ?? store.generate()
        const connection = await this.connection(listener, token)
        signal.throwIfAborted()
        if (this.stopped) throw new RemoteError('mobile-access/closing', 'The phone connection is closing', {})
        const authority = new URL(connection.url).host
        const untrust = this.owner.connection.registerTrustedHost(authority)
        const unauth = this.owner.phoneSessions.allowHost(authority, internet)
        withdraw = async () => { try { await unauth() } finally { await untrust() } }
        await store.save(token, true)
        this.active = { listener, withdraw, connection }
        return this.describe()
      } catch (error) {
        try { await withdraw?.() } finally { await listener.close() }
        throw error
      }
    })
  }

  /**
   * Replace the link and revoke all prior phone sessions after the new secret commits.
   * @param signal - cancels before persistence; an accepted commit completes revocation.
   * @returns the replacement link and QR code; persistence failure preserves the previous link.
   */
  @Remote
  regenerate(signal: AbortSignal): Promise<MobileAccessState> {
    this.requireComputer()
    return this.enqueue(async () => {
      const active = this.active
      if (active === undefined) throw new RemoteError('mobile-access/network-unavailable', 'Enable the phone connection first', {})
      const token = this.options.store.generate()
      const connection = await this.connection(active.listener, token)
      signal.throwIfAborted()
      await this.options.store.save(token, true)
      active.connection = connection
      await this.owner.phoneSessions.revoke()
      return this.describe()
    })
  }

  /**
   * Disable remote access until explicitly re-enabled, retaining local Agent tasks and the saved link.
   * @returns state after phone revocation and quiescent socket closure.
   */
  @Remote
  close(): Promise<MobileAccessState> {
    this.requireComputer()
    return this.enqueue(async () => {
      const token = this.options.store.token ?? this.options.store.generate()
      await this.options.store.save(token, false)
      await this.release()
      return this.describe()
    })
  }

  private snapshot(phone: boolean): MobileAccessState {
    return { mode: this.options.config.publicUrl === undefined ? 'lan' : 'internet', phone,
      networks: phone || this.options.config.publicUrl !== undefined ? [] : networks(),
      ...phone || this.active === undefined ? {} : { connection: this.active.connection } }
  }

  private requireComputer(): void {
    const caller = this.ctx.invocation?.peer
    if (caller !== undefined && caller.id !== this.owner.connection.browserPeer.id) {
      throw new RemoteError('mobile-access/computer-required', 'Manage the connection link from the computer', {})
    }
  }

  private async connection(listener: WebListener, token: string): Promise<NonNullable<MobileAccessState['connection']>> {
    const url = new URL('/neurix/pair', this.options.config.publicUrl ?? listener.origin)
    url.hash = new URLSearchParams({ connect: token }).toString()
    const qrCode = await QRCode.toDataURL(url.href, { errorCorrectionLevel: 'M', margin: 2, width: 256 })
    return { url: url.href, qrCode, encrypted: url.protocol === 'https:' }
  }

  private enqueue(operation: () => Promise<MobileAccessState>): Promise<MobileAccessState> {
    const task = this.tail.then(() => {
      if (this.stopped) throw new RemoteError('mobile-access/closing', 'The phone connection is closing', {})
      return operation()
    }).finally(() => { this.notify() })
    this.tail = task.then(() => {}, () => {})
    return task
  }

  private notify(): void { for (const changed of this.watchers) changed() }

  private async release(): Promise<void> {
    const active = this.active
    this.active = undefined
    if (active === undefined) return
    try { await active.withdraw() } finally { await active.listener.close() }
  }
}
