/** Loader-backed account login, same-Host HTTP access, revocation, and listener disposal. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { request as httpRequest } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { HostConnectionService, type ConnectionBrowserAuth } from '@deepseek-ai/dsh-client-connection'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import Typert from '@deepseek-ai/dsh-typert-registry'
import type { PeerScope, RemoteInvocation } from '@deepseek-ai/dsh-typert-protocol'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import QRCode, { type QRCodeToDataURLOptions } from 'qrcode'
const qrWriter: { toDataURL: (text: string, options: QRCodeToDataURLOptions) => Promise<string> } = QRCode
import * as Mobile from '../src/index.ts'
import type {} from '../src/account.ts'
import type {} from '../src/service.ts'
import { AccountStore } from '../src/account-store.ts'
import { MobileAccess } from '../src/service.ts'
import { NeurixAccount } from '../src/account.ts'

const timerFixture = vi.hoisted(() => ({ controlled: false, callbacks: new Map<NodeJS.Timeout, () => void>() }))
vi.mock('node:timers', async (load) => {
  const actual = await load<typeof import('node:timers')>()
  return { ...actual,
    setTimeout(callback: () => void, delay: number) {
      if (!timerFixture.controlled) return actual.setTimeout(callback, delay)
      const timer = actual.setTimeout(() => {}, 2 ** 31 - 1)
      timerFixture.callbacks.set(timer, callback)
      return timer
    },
    clearTimeout(timer: NodeJS.Timeout | undefined) {
      if (timer !== undefined) timerFixture.callbacks.delete(timer)
      actual.clearTimeout(timer)
    },
  }
})

vi.mock('node:os', async (load) => {
  const actual = await load<typeof import('node:os')>()
  return { ...actual, networkInterfaces: () => ({ test: [{ address: '127.0.0.1', family: 'IPv4', internal: false }], disconnected: undefined }) }
})

let ctx: Context
let root: string
const password = 'synthetic-test-password'
const signal = () => new AbortController().signal

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'neurix-mobile-'))
  ctx = new Context()
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', WebServer], ['@deepseek-ai/dsh-client-connection', Connection],
    ['@deepseek-ai/dsh-credentials-local', Credentials], ['@deepseek-ai/dsh-typert-registry', Typert],
    ['@deepseek-ai/dsh-experimental-mobile-access', Mobile],
  ])
  const config = join(root, 'cordis.yml')
  await writeFile(config, `- name: '@deepseek-ai/dsh-host-webserver'
  config: { host: 127.0.0.1, port: 0 }
- name: '@deepseek-ai/dsh-credentials-local'
  config: { dshHome: ${JSON.stringify(root)}, watch: false }
- name: '@deepseek-ai/dsh-client-connection'
- name: '@deepseek-ai/dsh-typert-registry'
- name: '@deepseek-ai/dsh-experimental-mobile-access'
  config: { port: 0, loginFailedAttempts: 2, loginCooldownMs: 10000 }
`)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const internal = ctx.loader.internal
  if (internal === undefined) throw new Error('Loader internals are unavailable')
  ctx.loader.internal = { ...internal, async import(specifier: string) {
    if (!modules.has(specifier)) throw new Error('Unexpected fixture import: ' + specifier)
    return modules.get(specifier)
  } }
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  ctx.effect(() => ctx.webServer.registerFallback((request, response) => {
    if (!ctx.connection.authorizeIndex(request, response)) return
    response.writeHead(200); response.end('SAME_HOST_APP')
  }))
})

afterEach(async () => {
  timerFixture.controlled = false
  vi.restoreAllMocks()
  try { await ctx?.fiber.dispose() } finally { await rm(root, { recursive: true, force: true }) }
})

async function open(): Promise<string> {
  await ctx.neurixAccount.register('test.owner', password)
  const result = await ctx.mobileAccess.open('127.0.0.1', signal())
  expect(result.connection?.url).not.toContain('token=')
  expect(result.connection?.qrCode).toMatch(/^data:image\/png;base64,/)
  return result.connection!.url
}

async function login(url: string, value = password): Promise<Response> {
  return fetch(new URL('/neurix/login', url), { method: 'POST', headers: {
    'Content-Type': 'application/json', Origin: new URL(url).origin,
  }, body: JSON.stringify({ username: 'test.owner', password: value }) })
}

describe('Neurix phone connection', () => {
  async function internet(options: { autoConnect?: boolean; publicUrl?: string; port?: number } = {}) {
    for (const fiber of [...(ctx.registry.get(Mobile)?.fibers ?? [])]) await fiber.dispose()
    const spy = vi.spyOn(WebServer.prototype, 'listen')
    await ctx.plugin(Mobile, { port: 0, publicUrl: 'https://agent.example.test/', ...options })
    return spy
  }

  function forwarded(origin: string, path: string, headers: Record<string, string>, body = ''): Promise<Response> {
    return new Promise((resolve, reject) => {
      const request = httpRequest(new URL(path, origin), { method: 'POST', headers: {
        ...headers, 'Content-Length': Buffer.byteLength(body),
      } }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => { chunks.push(chunk) })
        response.on('error', reject)
        response.on('end', () => {
          const fields = new Headers()
          for (const [name, values] of Object.entries(response.headers)) {
            for (const value of typeof values === 'string' ? [values] : values ?? []) fields.append(name, value)
          }
          resolve(new Response(response.statusCode === 204 ? null : Buffer.concat(chunks), {
            status: response.statusCode!, headers: fields,
          }))
        })
      })
      request.on('error', reject)
      request.end(body)
    })
  }

  it('advertises the HTTPS relay, binds only loopback, and requires the configured public authority', async () => {
    const spy = await internet()
    await ctx.neurixAccount.register('test.owner', password)
    await expect(ctx.mobileAccess.open('192.0.2.1', signal())).rejects.toMatchObject({ code: 'mobile-access/network-unavailable' })
    const state = await ctx.mobileAccess.open('127.0.0.1', signal())
    expect(state).toMatchObject({ mode: 'internet', networks: [], connection: { url: 'https://agent.example.test/', encrypted: true } })
    expect(spy).toHaveBeenCalledWith({ host: '127.0.0.1', port: 0 })
    const result = spy.mock.results[0]
    if (result?.type !== 'return') throw new Error('Internet backend did not bind')
    const listener = await result.value
    const response = await forwarded(listener.origin, '/neurix/login', {
      Host: 'agent.example.test', Origin: 'https://agent.example.test', 'Content-Type': 'application/json',
    }, JSON.stringify({ username: 'test.owner', password }))
    expect(response.status).toBe(204)
    expect(response.headers.get('set-cookie')).toContain('; Secure')
    const mismatch = await forwarded(listener.origin, '/neurix/login', {
      Host: 'wrong.example.test', Origin: 'https://wrong.example.test', 'Content-Type': 'application/json',
    }, JSON.stringify({ username: 'test.owner', password }))
    expect(mismatch.status).toBe(403)
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!
    const logout = await forwarded(listener.origin, '/neurix/logout', {
      Host: 'agent.example.test', Origin: 'https://agent.example.test', Cookie: cookie,
    })
    expect(logout.status).toBe(204)
    expect(logout.headers.get('set-cookie')).toContain('; Secure')
  })

  it('restores explicitly enabled internet access after sign-in and after a Host restart', async () => {
    await internet({ autoConnect: true })
    expect(ctx.mobileAccess.describe().connection).toBeUndefined()
    await ctx.neurixAccount.register('test.owner', password)
    await ctx.mobileAccess.open('127.0.0.1', signal())
    expect(ctx.mobileAccess.describe().connection?.encrypted).toBe(true)
    await ctx.neurixAccount.signOut()
    await ctx.mobileAccess.close()
    expect(ctx.mobileAccess.describe().connection).toBeUndefined()
    await ctx.neurixAccount.signIn('test.owner', password)
    await ctx.mobileAccess.open('127.0.0.1', signal())
    await internet({ autoConnect: true })
    await ctx.mobileAccess.open('127.0.0.1', signal())
    expect(ctx.mobileAccess.describe().connection?.url).toBe('https://agent.example.test/')
  })

  it.each(['http://agent.example.test', 'https://user:secret@agent.example.test', 'https://agent.example.test/path',
    'https://agent.example.test/?token=secret', 'https://agent.example.test/#fragment'])('rejects an unsafe public URL: %s', (publicUrl) => {
    expect(() => Mobile.Config({ publicUrl })).toThrow()
  })
  it('requires account login, serves the same Host, and revokes every phone Peer on sign-out', async () => {
    ctx.connection.fetch.register({ path: '/api/probe', methods: ['GET'], requestBody: 'buffered',
      fetch() { return Promise.resolve(new Response('EXISTING_AGENT')) } })
    const url = await open()
    expect(await (await fetch(url)).text()).toContain('Sign in to Neurix')
    expect((await fetch(new URL('/api/probe', url))).status).toBe(401)
    expect((await login(url, 'incorrect-test-password')).status).toBe(401)
    const signedIn = await login(url)
    expect(signedIn.status).toBe(204)
    const cookie = signedIn.headers.get('set-cookie')!.split(';')[0]!
    const admission = ctx.connection.admit({ headers: { host: new URL(url).host, cookie } })
    if ('rejection' in admission) throw new Error('Phone cookie was not admitted')
    const phonePeer: PeerScope = admission.peer
    expect(signedIn.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict')
    expect(await (await fetch(url, { headers: { Cookie: cookie } })).text()).toBe('SAME_HOST_APP')
    const result = await fetch(new URL('/api/probe', url), { headers: { Cookie: cookie } })
    expect(await result.text()).toBe('EXISTING_AGENT')
    expect(phonePeer?.signal.aborted).toBe(false)
    const rebound = await fetch(new URL('/api/probe', url), { headers: { Cookie: cookie, Origin: 'https://untrusted.test' } })
    expect(rebound.status).toBe(403)
    await ctx.neurixAccount.signOut()
    expect(phonePeer?.signal.aborted).toBe(true)
    expect((await fetch(new URL('/api/probe', url), { headers: { Cookie: cookie } })).status).toBe(401)
    expect((await login(url)).status).toBe(401)
    expect(await readFile(join(root, '.credentials.yaml'), 'utf8')).not.toContain(password)
  })

  it('refuses network access before local account setup and cancels before binding', async () => {
    await expect(ctx.mobileAccess.open('127.0.0.1', signal())).rejects.toMatchObject({ code: 'neurix-account/sign-in-required' })
    await ctx.neurixAccount.register('test.owner', password)
    await expect(ctx.mobileAccess.open('192.0.2.1', signal())).rejects.toMatchObject({ code: 'mobile-access/network-unavailable' })
    await expect(ctx.mobileAccess.open('127.0.0.1', AbortSignal.abort())).rejects.toBeDefined()
    expect(ctx.mobileAccess.describe().connection).toBeUndefined()
  })

  it('closes network admission without stopping the original application and closes again safely', async () => {
    const url = await open()
    const port = new URL(url).port
    await ctx.mobileAccess.close()
    await ctx.mobileAccess.close()
    await expect(fetch(url)).rejects.toThrow()
    expect(ctx.webServer.port).not.toBe(Number(port))
    const local = await fetch(ctx.connection.authenticatedUrl(ctx.webServer.getOrigin()), { redirect: 'manual' })
    expect(local.status).toBe(303)
  })

  it('keeps passwords private, retains the account on reload, and limits repeated bad credentials', async () => {
    await ctx.neurixAccount.register('Test.Owner', password)
    await expect(ctx.neurixAccount.register('other.owner', password)).rejects.toMatchObject({ code: 'neurix-account/already-configured' })
    const store = new AccountStore(ctx.credentials, { failedAttempts: 2, cooldownMs: 10_000, pendingAttempts: 8 })
    await store.load()
    expect(store.describe()).toEqual({ configured: true, signedIn: true, username: 'test.owner' })
    await expect(store.authenticate('test.owner', 'incorrect-test-password', true)).rejects.toMatchObject({ code: 'neurix-account/invalid-credentials' })
    await expect(store.authenticate('test.owner', 'incorrect-test-password', true)).rejects.toMatchObject({ code: 'neurix-account/invalid-credentials' })
    await expect(store.authenticate('test.owner', password, true)).rejects.toMatchObject({ code: 'neurix-account/rate-limited' })
    const later = Date.now() + 11_000
    vi.spyOn(Date, 'now').mockReturnValue(later)
    expect(await store.authenticate('TEST.OWNER', password, true)).toMatchObject({ signedIn: true })
    await store.signOut()
    expect(store.describe().signedIn).toBe(false)
    await expect(store.register('bad', 'short')).rejects.toMatchObject({ code: 'neurix-account/invalid-input' })
  })

  it('rejects malformed, oversized and cross-site login requests without creating a session', async () => {
    const url = await open()
    const endpoint = new URL('/neurix/login', url)
    expect((await fetch(endpoint)).status).toBe(405)
    expect((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: password })).status).toBe(405)
    expect((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status).toBe(401)
    expect((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(4097) })).status).toBe(413)
    const crossed = await fetch(endpoint, { method: 'POST', headers: {
      'Content-Type': 'application/json', Origin: 'https://untrusted.test',
    }, body: JSON.stringify({ username: 'test.owner', password }) })
    expect(crossed.status).toBe(403)
    const chinese = await fetch(url, { headers: { 'Accept-Language': 'zh-CN' } })
    expect(await chinese.text()).toContain('登录 Neurix')
    expect((await fetch(new URL('/neurix/login', ctx.webServer.getOrigin()), { method: 'POST' })).status).toBe(403)
  })

  it('revokes active phone sessions on disconnect and rejects a forged cookie', async () => {
    const url = await open()
    const signedIn = await login(url)
    const cookie = signedIn.headers.get('set-cookie')!.split(';')[0]!
    const admission = ctx.connection.admit({ headers: new Headers({ host: new URL(url).host, cookie }) })
    if ('rejection' in admission) throw new Error('Phone was not admitted')
    expect(ctx.connection.admit({ headers: { host: new URL(url).host, cookie: cookie + 'forged' } })).toEqual({ rejection: 401 })
    await ctx.mobileAccess.close()
    expect(admission.peer.signal.aborted).toBe(true)
    await ctx.neurixAccount.signOut()
    expect(await ctx.neurixAccount.signIn('test.owner', password)).toMatchObject({ signedIn: true })
  })

  it('joins a canceled QR acquisition and closes its network listener before reporting failure', async () => {
    await ctx.neurixAccount.register('test.owner', password)
    const entered = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    vi.spyOn(qrWriter, 'toDataURL').mockImplementation(async () => { entered.resolve(undefined); await released.promise; return 'data:image/png;base64,fixture' })
    const controller = new AbortController()
    const pending = ctx.mobileAccess.open('127.0.0.1', controller.signal)
    const refused = expect(pending).rejects.toBeDefined()
    await entered.promise
    controller.abort()
    released.resolve(undefined)
    await refused
    expect(ctx.mobileAccess.describe().connection).toBeUndefined()
  })

  it('joins accepted password operations at disposal and refuses a full login queue', async () => {
    const store = new AccountStore(ctx.credentials, { failedAttempts: 2, cooldownMs: 10_000, pendingAttempts: 1 })
    await store.load()
    const pending = store.register('test.owner', password)
    await expect(store.register('other.owner', password)).rejects.toMatchObject({ code: 'neurix-account/rate-limited' })
    await store.dispose()
    expect(await pending).toMatchObject({ configured: true })
    await expect(store.authenticate('test.owner', password, true)).rejects.toMatchObject({ code: 'neurix-account/rate-limited' })
    await ctx.credentials.modifyRecord(credentialKey('neurix-account', 'owner'), () => Promise.resolve({ kind: 'grant', payload: { version: 77 } }))
    await expect(new AccountStore(ctx.credentials, { failedAttempts: 2, cooldownMs: 1, pendingAttempts: 1 }).load()).rejects.toThrow()
  })

  it('expires phone Peers independently and refuses logins beyond the session limit', async () => {
    const original = [...ctx.loader.entries()].find(entry => entry.options.name.includes('mobile-access'))?.fiber
    if (original === undefined) throw new Error('Phone fixture did not load')
    await original.dispose()
    await ctx.plugin(Mobile, { port: 0, sessionMaxAgeMs: 1000, maxPhoneSessions: 2 })
    const url = await open()
    let clock = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    timerFixture.controlled = true
    try {
      const first = await login(url)
      const firstCookie = first.headers.get('set-cookie')!.split(';')[0]!
      const a = ctx.connection.admit({ headers: { host: new URL(url).host, cookie: firstCookie } })
      if ('rejection' in a) throw new Error('First phone was not admitted')
      clock += 500
      const second = await login(url)
      const secondCookie = second.headers.get('set-cookie')!.split(';')[0]!
      const b = ctx.connection.admit({ headers: { host: new URL(url).host, cookie: secondCookie } })
      if ('rejection' in b) throw new Error('Second phone was not admitted')
      expect((await login(url)).status).toBe(429)
      clock += 500
      const firstExpired = new Promise<void>((resolve) => { a.peer.signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      for (const callback of [...timerFixture.callbacks.values()]) callback()
      await firstExpired
      expect(a.peer.signal.aborted).toBe(true)
      expect(b.peer.signal.aborted).toBe(false)
      expect(ctx.connection.admit({ headers: { host: new URL(url).host, cookie: firstCookie } })).toEqual({ rejection: 401 })
      clock += 500
      const secondExpired = new Promise<void>((resolve) => { b.peer.signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      for (const callback of [...timerFixture.callbacks.values()]) callback()
      await secondExpired
      expect(b.peer.signal.aborted).toBe(true)
    } finally { timerFixture.controlled = false }
  })

  it('keeps one listener for repeated connection requests and waits for an in-flight open during disposal', async () => {
    const url = await open()
    expect((await ctx.mobileAccess.open('127.0.0.1', signal())).connection?.url).toBe(url)
    await ctx.mobileAccess.close()
    const entered = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    vi.spyOn(qrWriter, 'toDataURL').mockImplementation(async () => { entered.resolve(undefined); await released.promise; return 'data:image/png;base64,fixture' })
    const controller = ctx.mobileAccess
    const pending = controller.open('127.0.0.1', signal())
    const refused = expect(pending).rejects.toMatchObject({ code: 'mobile-access/closing' })
    await entered.promise
    const fiber = [...(ctx.registry.get(MobileAccess)?.fibers ?? [])][0]
    if (fiber === undefined) throw new Error('Phone controller was not mounted')
    const stopping = Promise.withResolvers<undefined>()
    const off = ctx.on('internal/status', (subject) => {
      if (subject === fiber && subject.state === FiberState.UNLOADING) stopping.resolve(undefined)
    })
    const unloading = fiber.dispose()
    await stopping.promise
    released.resolve(undefined)
    await refused
    await unloading
    off()
    await expect(controller.close()).rejects.toMatchObject({ code: 'mobile-access/closing' })
  })

  it('rejects missing, unrelated, expired, and retired browser credentials at the authentication provider', async () => {
    const entry = [...ctx.loader.entries()].find(item => item.options.name.includes('mobile-access'))?.fiber
    if (entry === undefined) throw new Error('Phone fixture did not load')
    await entry.dispose()
    let provider: ConnectionBrowserAuth | undefined
    // oxlint-disable-next-line typescript/unbound-method -- The replacement calls the method with its original service receiver.
    const register = HostConnectionService.prototype.registerBrowserAuth
    vi.spyOn(HostConnectionService.prototype, 'registerBrowserAuth').mockImplementation(function (this: HostConnectionService, value) {
      provider = value
      return register.call(this, value)
    })
    await ctx.plugin(Mobile, { port: 0 })
    const url = await open()
    if (provider === undefined) throw new Error('Account authentication was not registered')
    expect(provider.authenticate({ headers: {} })).toBeUndefined()
    expect(provider.authenticate({ headers: new Headers({ host: new URL(url).host }) })).toBeUndefined()
    expect(provider.authenticate({ headers: { host: new URL(url).host, cookie: ['invalid'] } })).toBeUndefined()
    expect(provider.authorizeIndex({ method: 'GET', url: '/', headers: {} }, { writeHead() {}, end() {} })).toBeUndefined()
    const signedIn = await login(url)
    const cookie = signedIn.headers.get('set-cookie')!.split(';')[0]!
    const other = ctx.neurixAccount.allowHost('other.test')
    await other()
    expect(provider.authenticate({ headers: { host: new URL(url).host, cookie } })).toBeDefined()
    const later = Date.now() + 25 * 60 * 60 * 1000
    vi.spyOn(Date, 'now').mockReturnValue(later)
    expect(provider.authenticate({ headers: { host: new URL(url).host, cookie } })).toBeUndefined()
    const fiber = [...(ctx.registry.get(NeurixAccount)?.fibers ?? [])][0]
    if (fiber === undefined) throw new Error('Account service was not mounted')
    await fiber.dispose()
    expect(provider.authenticate({ headers: { host: new URL(url).host, cookie } })).toBeUndefined()
  })

  it.each(['sign-out', 'withdrawal'])('does not publish a phone cookie after %s during password verification', async (action) => {
    let withdraw: (() => Promise<void>) | undefined
    // oxlint-disable-next-line typescript/unbound-method -- The replacement preserves the original account-service receiver.
    const allow = NeurixAccount.prototype.allowHost
    vi.spyOn(NeurixAccount.prototype, 'allowHost').mockImplementation(function (this: NeurixAccount, host) {
      withdraw = allow.call(this, host)
      return withdraw
    })
    const url = await open()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    // oxlint-disable-next-line typescript/unbound-method -- The wrapper preserves the actual store receiver.
    const original = AccountStore.prototype.authenticate
    vi.spyOn(AccountStore.prototype, 'authenticate').mockImplementation(async function (this: AccountStore, username, value, signInHost) {
      const result = await original.call(this, username, value, signInHost)
      entered.resolve(undefined)
      await release.promise
      return result
    })
    const pending = login(url)
    await entered.promise
    try {
      if (action === 'sign-out') await ctx.neurixAccount.signOut()
      else {
        if (withdraw === undefined) throw new Error('Phone authority was not registered')
        await withdraw()
      }
    } finally { release.resolve(undefined) }
    const response = await pending
    expect(response.status).toBe(403)
    expect(response.headers.has('set-cookie')).toBe(false)
  })

  it('marks phone credentials Secure when the application carrier serves HTTPS', async () => {
    const url = await open()
    vi.spyOn(WebServer.prototype, 'protocol', 'get').mockReturnValue('https:')
    expect((await login(url)).headers.get('set-cookie')).toContain('; Secure')
  })

  it('logs out one phone while retaining the computer and another phone session', async () => {
    const url = await open()
    const a = await login(url)
    const b = await login(url)
    const cookieA = a.headers.get('set-cookie')!.split(';')[0]!
    const cookieB = b.headers.get('set-cookie')!.split(';')[0]!
    const authority = new URL(url).host
    const admissionA = ctx.connection.admit({ headers: { host: authority, cookie: cookieA } })
    if ('rejection' in admissionA) throw new Error('Phone was not admitted')
    const endpoint = new URL('/neurix/logout', url)
    expect((await fetch(endpoint)).status).toBe(405)
    expect((await fetch(endpoint, { method: 'POST' })).status).toBe(401)
    expect((await fetch(endpoint, { method: 'POST', headers: { Cookie: cookieA, Origin: 'https://untrusted.test' } })).status).toBe(401)
    const signedOut = await fetch(endpoint, { method: 'POST', headers: { Cookie: cookieA, Origin: new URL(url).origin } })
    expect(signedOut.status).toBe(204)
    expect(signedOut.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(admissionA.peer.signal.aborted).toBe(true)
    expect(ctx.connection.admit({ headers: { host: authority, cookie: cookieA } })).toEqual({ rejection: 401 })
    expect(ctx.connection.admit({ headers: { host: authority, cookie: cookieB } })).not.toHaveProperty('rejection')
    expect(ctx.neurixAccount.describe().signedIn).toBe(true)
    const invocation = (peer: PeerScope): RemoteInvocation => ({
      request: { namespace: 'neurixAccount', method: 'signOut', args: {} }, service: 'neurixAccount', peer, signal: signal(),
      uplink() { throw new Error('This fixture does not open an uplink') },
    })
    const admissionB = ctx.connection.admit({ headers: { host: authority, cookie: cookieB } })
    if ('rejection' in admissionB) throw new Error('Second phone was not admitted')
    expect(ctx.extend({ invocation: invocation(admissionB.peer) }).neurixAccount.describe().phone).toBe(true)
    expect(ctx.extend({ invocation: invocation(ctx.connection.browserPeer) }).neurixAccount.describe().phone).toBe(false)
    await expect(ctx.extend({ invocation: invocation(admissionB.peer) }).neurixAccount.signOut())
      .rejects.toMatchObject({ code: 'neurix-account/device-logout-required' })
    await ctx.extend({ invocation: invocation(ctx.connection.browserPeer) }).neurixAccount.signOut()
    expect(ctx.neurixAccount.describe().signedIn).toBe(false)
  })

  it('reports a phone logout cleanup failure after revoking its credential', async () => {
    const url = await open()
    const result = await login(url)
    const cookie = result.headers.get('set-cookie')!.split(';')[0]!
    const request = { headers: { host: new URL(url).host, cookie } }
    const admission = ctx.connection.admit(request)
    if ('rejection' in admission) throw new Error('Phone was not admitted')
    vi.spyOn(admission.peer, 'dispose').mockRejectedValueOnce(new Error('fixture cleanup failure'))
    expect((await fetch(new URL('/neurix/logout', url), { method: 'POST', headers: { Cookie: cookie } })).status).toBe(503)
    expect(ctx.connection.admit(request)).toEqual({ rejection: 401 })
  })

  it('reports an expiry cleanup failure while keeping expired credentials revoked', async () => {
    const entry = [...ctx.loader.entries()].find(item => item.options.name.includes('mobile-access'))?.fiber
    if (entry === undefined) throw new Error('Phone fixture did not load')
    await entry.dispose()
    await ctx.plugin(Mobile, { port: 0, sessionMaxAgeMs: 1000 })
    const url = await open()
    let clock = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    timerFixture.controlled = true
    const reported = Promise.withResolvers<undefined>()
    ctx.logger.exporter({ export(message) {
      if (message.args[0] === 'Neurix phone session cleanup failed') reported.resolve(undefined)
    } })
    const response = await login(url)
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!
    const admission = ctx.connection.admit({ headers: { host: new URL(url).host, cookie } })
    if ('rejection' in admission) throw new Error('Phone cookie was not admitted')
    vi.spyOn(admission.peer, 'dispose').mockRejectedValueOnce(new Error('fixture cleanup failure'))
    clock += 1000
    for (const callback of [...timerFixture.callbacks.values()]) callback()
    await reported.promise
    expect(ctx.connection.admit({ headers: { host: new URL(url).host, cookie } })).toEqual({ rejection: 401 })
  })
})
