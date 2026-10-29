/** Neurix owner account and revocable phone browser sessions. @module */
import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { setTimeout, clearTimeout } from 'node:timers'
import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import type { ConnectionBrowserAuth, ConnectionTrustRequest } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { z } from 'zod'
import type { AccountStore } from './account-store.ts'
import { loginPage } from './login-page.ts'
import type { NeurixAccountState } from './types.ts'

const loginSchema = z.object({ username: z.string().max(80), password: z.string().max(128) })

function header(request: ConnectionTrustRequest, name: string): string | undefined {
  if (request.headers instanceof Headers) return request.headers.get(name) ?? undefined
  const value = request.headers[name]
  return typeof value === 'string' ? value : undefined
}

function digest(text: string): string { return createHash('sha256').update(text).digest('hex') }
function cookieName(host: string): string { return `neurix-session-${digest(host).slice(0, 16)}` }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Neurix account identity, separate from model-provider credentials. */
    neurixAccount: NeurixAccount
  }
  interface Events {
    /**
     * Publish committed computer-account state for connection management.
     * @param state - safe account state after local registration, sign-in, or sign-out.
     * @mode emit
     */
    'neurix-account/changed'(state: NeurixAccountState): void
  }
}

/** Credential storage stays Host-only; each phone receives a revocable owner Peer. */
export class NeurixAccount extends TypertRemoteService {
  static inject = ['webServer', 'connection', 'typert']
  private readonly hosts = new Map<string, boolean>()
  private readonly sessions = new Map<string, { host: string; expiresAt: number; peer: PeerScope }>()
  private readonly requests = new Set<Promise<void>>()
  private readonly expiryTasks = new Set<Promise<void>>()
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly owner: Context, private readonly options: {
    store: AccountStore
    sessionMaxAgeMs: number
    maxPhoneSessions: number
  }) {
    super(owner, 'neurixAccount', { namespace: 'neurixAccount' })
    const browser: ConnectionBrowserAuth = {
      authenticate: request => this.authenticateRequest(request),
      authorizeIndex: (request, response) => {
        if (!this.hosts.has(header(request, 'host') ?? '')) return undefined
        if (this.authenticateRequest(request) !== undefined) return true
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' })
        response.end(loginPage(header(request, 'accept-language')?.toLowerCase().startsWith('zh') === true))
        return false
      },
    }
    owner.connection.registerBrowserAuth(browser)
    owner.effect(() => owner.webServer.register({ kind: 'exact', path: '/neurix/login', handler: (request, response) => {
      const task = this.login(request, response)
      this.requests.add(task)
      const remove = () => { this.requests.delete(task) }
      void task.then(remove, remove)
      return task
    } }))
    owner.effect(() => owner.webServer.register({ kind: 'exact', path: '/neurix/logout', handler: (request, response) => {
      const task = this.logout(request, response)
      this.requests.add(task)
      const remove = () => { this.requests.delete(task) }
      void task.then(remove, remove)
      return task
    } }))
    owner.effect(() => async () => {
      this.stopped = true
      await this.revoke()
      await Promise.allSettled(this.requests)
      await Promise.allSettled(this.expiryTasks)
    }, 'neurix-account: browser sessions')
  }

  /**
   * Read the bound Neurix owner.
   * @returns safe account state and whether the caller is an authenticated phone.
   */
  @Remote
  describe(): NeurixAccountState {
    const caller = this.ctx.invocation?.peer
    return { ...this.options.store.describe(),
      phone: caller !== undefined && [...this.sessions.values()].some(session => session.peer.id === caller.id) }
  }

  /**
   * Create the first owner from an already trusted installation UI.
   * @param username - new Neurix account name.
   * @param password - password, stored only as a salted scrypt-derived key.
   * @returns persisted safe account state.
   */
  @Remote
  async register(username: string, password: string): Promise<NeurixAccountState> {
    const state = await this.options.store.register(username, password)
    this.owner.emit('neurix-account/changed', state)
    return state
  }

  /**
   * Sign this computer into its existing Neurix account.
   * @param username - owner name.
   * @param password - password, never included in a result or Session log.
   * @returns safe signed-in account state.
   */
  @Remote
  async signIn(username: string, password: string): Promise<NeurixAccountState> {
    const state = await this.options.store.authenticate(username, password, true)
    this.owner.emit('neurix-account/changed', state)
    return state
  }

  /**
   * Sign the computer out and revoke phone access; phone callers must use the independent logout route.
   * @returns safe state after every phone Peer has been revoked.
   */
  @Remote
  async signOut(): Promise<NeurixAccountState> {
    const caller = this.ctx.invocation?.peer
    if (caller !== undefined && [...this.sessions.values()].some(session => session.peer.id === caller.id)) {
      throw new RemoteError('neurix-account/device-logout-required', 'Use this phone’s logout action', {})
    }
    const result = await this.options.store.signOut()
    await this.revoke()
    this.owner.emit('neurix-account/changed', result)
    return result
  }

  /**
   * Require account login for an additional listener, then revoke its phone sessions on withdrawal.
   * @param host - exact authority of the listener or configured HTTPS reverse proxy.
   * @param secure - require Secure cookies for an explicitly configured HTTPS public endpoint.
   * @returns idempotent withdrawal owned by this activation.
   */
  allowHost(host: string, secure = false): () => Promise<void> {
    return this.owner.effect(() => {
      this.hosts.set(host, secure)
      return async () => {
        this.hosts.delete(host)
        const pending: Promise<void>[] = []
        for (const [token, session] of this.sessions) {
          if (session.host !== host) continue
          this.sessions.delete(token)
          pending.push(session.peer.dispose())
        }
        this.scheduleExpiry()
        await Promise.all(pending)
      }
    }, 'neurix-account: phone authority')
  }

  private authenticateRequest(request: ConnectionTrustRequest): PeerScope | undefined {
    if (this.stopped || !this.describe().signedIn) return undefined
    const host = header(request, 'host') ?? ''
    if (!this.hosts.has(host)) return undefined
    const prefix = cookieName(host) + '='
    const token = header(request, 'cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(prefix))?.slice(prefix.length)
    if (token === undefined) return undefined
    const session = this.sessions.get(digest(token))
    return session !== undefined && session.host === host && session.expiresAt > Date.now() ? session.peer : undefined
  }

  private async login(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('Cache-Control', 'no-store')
    const host = request.headers.host
    if (!this.canAccept(host) || this.owner.connection.requestRejection(request) === 403) {
      response.writeHead(403); response.end(); return
    }
    if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json') {
      response.writeHead(405); response.end(); return
    }
    try {
      const chunks: Buffer[] = []
      let size = 0
      // This route owns the untouched node:http byte stream; no caller sets a text encoding.
      for await (const chunk of request.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>) {
        size += chunk.byteLength
        if (size > 4096) { response.writeHead(413, { Connection: 'close' }); response.end(); return }
        chunks.push(chunk)
      }
      const input = loginSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      await this.options.store.authenticate(input.username, input.password, false)
      if (!this.canAccept(host) || !this.describe().signedIn) {
        response.writeHead(403); response.end(); return
      }
      if (this.sessions.size >= this.options.maxPhoneSessions) { response.writeHead(429); response.end(); return }
      const token = randomBytes(32).toString('base64url')
      const peer = this.owner.connection.createPeer({ principal: { kind: 'owner' }, interactions: 'answer' })
      this.sessions.set(digest(token), { host, peer, expiresAt: Date.now() + this.options.sessionMaxAgeMs })
      this.scheduleExpiry()
      response.writeHead(204, { 'Set-Cookie': `${cookieName(host)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${String(Math.floor(this.options.sessionMaxAgeMs / 1000))}${this.secureHost(host) ? '; Secure' : ''}` })
      response.end()
    } catch (_error) {
      response.writeHead(401); response.end()
    }
  }

  private canAccept(host: string | undefined): host is string {
    return host !== undefined && !this.stopped && this.hosts.has(host)
  }

  private secureHost(host: string): boolean {
    return this.hosts.get(host) === true || this.owner.webServer.protocol === 'https:'
  }

  private async logout(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('Cache-Control', 'no-store')
    request.resume()
    if (request.method !== 'POST') { response.writeHead(405); response.end(); return }
    const admission = this.owner.connection.admit(request)
    const peer = this.authenticateRequest(request)
    if ('rejection' in admission || peer === undefined) { response.writeHead(401); response.end(); return }
    for (const [token, session] of this.sessions) {
      if (session.peer.id === peer.id) this.sessions.delete(token)
    }
    this.scheduleExpiry()
    // Successful Connection admission requires a string Host header.
    const host = request.headers.host as string
    response.setHeader('Set-Cookie', `${cookieName(host)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${this.secureHost(host) ? '; Secure' : ''}`)
    try {
      await peer.dispose()
      response.writeHead(204)
    } catch (error) {
      this.owner.logger.error('Neurix phone logout cleanup failed', error)
      response.writeHead(503)
    }
    response.end()
  }

  private scheduleExpiry(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    if (this.stopped || this.sessions.size === 0) return
    const next = Math.min(...[...this.sessions.values()].map(session => session.expiresAt))
    this.timer = setTimeout(() => {
      const tasks: Promise<void>[] = []
      for (const [token, session] of this.sessions) {
        if (session.expiresAt > Date.now()) continue
        this.sessions.delete(token)
        tasks.push(session.peer.dispose())
      }
      const task = Promise.all(tasks).then(() => undefined)
      this.expiryTasks.add(task)
      void task.catch((error: unknown) => { this.owner.logger.error('Neurix phone session cleanup failed', error) })
        .finally(() => { this.expiryTasks.delete(task) })
      this.scheduleExpiry()
    }, Math.max(0, next - Date.now()))
    this.timer.unref()
  }

  private async revoke(): Promise<void> {
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    await Promise.all(sessions.map(session => session.peer.dispose()))
  }
}
