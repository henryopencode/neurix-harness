/** Revocable phone browser sessions admitted by the private connection link. @module */
import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { setTimeout, clearTimeout } from 'node:timers'
import { Context, Service } from '@deepseek-ai/cordis'
import type { PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import type { ConnectionBrowserAuth, ConnectionIndexResponse, ConnectionTrustRequest } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { z } from 'zod'
import type { LinkStore } from './link-store.ts'
import { connectPage } from './connect-page.ts'

const inputSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
function header(request: ConnectionTrustRequest, name: string): string | undefined {
  if (request.headers instanceof Headers) return request.headers.get(name) ?? undefined
  const value = request.headers[name]
  return typeof value === 'string' ? value : undefined
}
function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }
function cookieName(host: string): string { return `neurix-phone-${digest(host).slice(0, 16)}` }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Link-authenticated phone sessions owned by the current plugin activation. */
    phoneSessions: PhoneSessions
  }
}

/** Each phone gets an independent owner Peer; withdrawing access revokes live streams too. */
export class PhoneSessions extends Service {
  static inject = ['webServer', 'connection']
  private readonly hosts = new Map<string, boolean>()
  private readonly sessions = new Map<string, { host: string; expiresAt: number; peer: PeerScope }>()
  private readonly requests = new Set<Promise<void>>()
  private readonly expiryTasks = new Set<Promise<void>>()
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly owner: Context, private readonly options: {
    store: LinkStore
    sessionMaxAgeMs: number
    maxPhoneSessions: number
  }) {
    super(owner, 'phoneSessions')
    const browser: ConnectionBrowserAuth = {
      authenticate: request => this.authenticateRequest(request),
      authorizeIndex: (request, response) => {
        if (!this.hosts.has(header(request, 'host') ?? '')) return undefined
        if (this.authenticateRequest(request) !== undefined) return true
        this.page(request, response)
        return false
      },
    }
    owner.connection.registerBrowserAuth(browser)
    const routes = [
      { path: '/neurix/pair', run: (request: IncomingMessage, response: ServerResponse) => {
        this.pair(request, response)
        return Promise.resolve()
      } },
      { path: '/neurix/connect', run: (request: IncomingMessage, response: ServerResponse) => this.connect(request, response) },
      { path: '/neurix/disconnect', run: (request: IncomingMessage, response: ServerResponse) => this.disconnect(request, response) },
    ]
    for (const route of routes) owner.effect(() => owner.webServer.register({ kind: 'exact', path: route.path,
      handler: (request, response) => {
        const task = route.run(request, response)
        this.requests.add(task)
        const remove = () => { this.requests.delete(task) }
        void task.then(remove, remove)
        return task
      },
    }))
    owner.effect(() => async () => {
      this.stopped = true
      this.hosts.clear()
      await this.revoke()
      await Promise.allSettled(this.requests)
      await Promise.allSettled(this.expiryTasks)
    }, 'mobile-access: browser sessions')
  }

  /**
   * Identify a phone caller without accepting identity from request arguments.
   * @param peer - authenticated invocation Peer, absent for in-process startup.
   * @returns whether this activation issued the caller's phone session.
   */
  isPhone(peer: PeerScope | undefined): boolean {
    return peer !== undefined && [...this.sessions.values()].some(session => session.peer.id === peer.id)
  }

  /**
   * Authorize link exchange on an exact listener or HTTPS proxy authority.
   * @param host - canonical host or host:port.
   * @param secure - whether this configured authority uses HTTPS.
   * @returns idempotent withdrawal that revokes all admitted phone Peers.
   */
  allowHost(host: string, secure: boolean): () => Promise<void> {
    return this.owner.effect(() => {
      this.hosts.set(host, secure)
      return async () => { this.hosts.delete(host); await this.revoke() }
    }, 'mobile-access: phone authority')
  }

  /** Revoke all browser cookies and await every phone Peer's disposal; the link remains stored. */
  async revoke(): Promise<void> {
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    await Promise.all(sessions.map(session => session.peer.dispose()))
  }

  private page(request: ConnectionTrustRequest, response: ConnectionIndexResponse): void {
    const nonce = randomBytes(16).toString('base64')
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`,
    })
    response.end(connectPage(header(request, 'accept-language')?.toLowerCase().startsWith('zh') === true, nonce))
  }

  private pair(request: IncomingMessage, response: ServerResponse): void {
    request.resume()
    if (!this.canAccept(request.headers.host) || this.owner.connection.requestRejection(request) === 403) {
      response.writeHead(403); response.end(); return
    }
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
    this.page(request, response)
  }

  private authenticateRequest(request: ConnectionTrustRequest): PeerScope | undefined {
    if (this.stopped || this.options.store.enabled !== true) return undefined
    const host = header(request, 'host') ?? ''
    if (!this.hosts.has(host)) return undefined
    const prefix = cookieName(host) + '='
    const token = header(request, 'cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(prefix))?.slice(prefix.length)
    if (token === undefined) return undefined
    const session = this.sessions.get(digest(token))
    return session !== undefined && session.host === host && session.expiresAt > Date.now() ? session.peer : undefined
  }

  private async connect(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('Cache-Control', 'no-store')
    const host = request.headers.host
    if (!this.canAccept(host) || this.owner.connection.requestRejection(request) === 403) {
      request.resume(); response.writeHead(403); response.end(); return
    }
    if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json') {
      request.resume(); response.writeHead(405); response.end(); return
    }
    const chunks: Buffer[] = []
    let size = 0
    // This route owns the untouched node:http byte stream; no caller sets a text encoding.
    for await (const chunk of request.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>) {
      size += chunk.byteLength
      if (size > 4096) { response.writeHead(413, { Connection: 'close' }); response.end(); return }
      chunks.push(chunk)
    }
    let input: z.infer<typeof inputSchema>
    try { input = inputSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
    catch (_error) { response.writeHead(401); response.end(); return }
    if (!this.canAccept(host) || !this.options.store.accepts(input.token)) {
      response.writeHead(401); response.end(); return
    }
    if (this.authenticateRequest(request) !== undefined) { response.writeHead(204); response.end(); return }
    if (this.sessions.size >= this.options.maxPhoneSessions) { response.writeHead(429); response.end(); return }
    const token = randomBytes(32).toString('base64url')
    const peer = this.owner.connection.createPeer({ principal: { kind: 'owner' }, interactions: 'answer' })
    this.sessions.set(digest(token), { host, peer, expiresAt: Date.now() + this.options.sessionMaxAgeMs })
    this.scheduleExpiry()
    response.writeHead(204, { 'Set-Cookie': `${cookieName(host)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${String(Math.floor(this.options.sessionMaxAgeMs / 1000))}${this.secureHost(host) ? '; Secure' : ''}` })
    response.end()
  }

  private canAccept(host: string | undefined): host is string {
    return host !== undefined && !this.stopped && this.hosts.has(host)
  }

  private secureHost(host: string): boolean {
    return this.hosts.get(host) === true || this.owner.webServer.protocol === 'https:'
  }

  private async disconnect(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('Cache-Control', 'no-store')
    request.resume()
    if (request.method !== 'POST') { response.writeHead(405); response.end(); return }
    const admission = this.owner.connection.admit(request)
    const peer = this.authenticateRequest(request)
    if ('rejection' in admission || peer === undefined) { response.writeHead(401); response.end(); return }
    for (const [token, session] of this.sessions) if (session.peer.id === peer.id) this.sessions.delete(token)
    this.scheduleExpiry()
    // Successful Connection admission requires a string Host header.
    const host = request.headers.host as string
    response.setHeader('Set-Cookie', `${cookieName(host)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${this.secureHost(host) ? '; Secure' : ''}`)
    try { await peer.dispose(); response.writeHead(204) }
    catch (error) { this.owner.logger.error('Phone disconnection cleanup failed', error); response.writeHead(503) }
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
      void task.catch((error: unknown) => { this.owner.logger.error('Phone session cleanup failed', error) })
        .finally(() => { this.expiryTasks.delete(task) })
      this.scheduleExpiry()
    }, Math.max(0, next - Date.now()))
    this.timer.unref()
  }
}
