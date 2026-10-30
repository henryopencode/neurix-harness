/** Loader-backed account login, same-Host HTTP access, revocation, and listener disposal. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { request as httpRequest } from 'node:http'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import Typert from '@deepseek-ai/dsh-typert-registry'
import type { PeerScope, RemoteInvocation } from '@deepseek-ai/dsh-typert-protocol'
import QRCode, { type QRCodeToDataURLOptions } from 'qrcode'
const qrWriter: { toDataURL: (text: string, options: QRCodeToDataURLOptions) => Promise<string> } = QRCode
import * as Mobile from '../src/index.ts'
import type {} from '../src/phone-sessions.ts'
import type {} from '../src/service.ts'
import { LinkStore } from '../src/link-store.ts'
import { MobileAccess } from '../src/service.ts'

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
  config: { port: 0 }
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
  const state = await ctx.mobileAccess.open('127.0.0.1', signal())
  expect(state.connection?.qrCode).toMatch(/^data:image\/png;base64,/)
  const url = state.connection!.url
  expect(new URL(url).search).toBe('')
  expect(secret(url)).toMatch(/^[A-Za-z0-9_-]{43}$/)
  return url
}
function secret(url: string): string { return new URLSearchParams(new URL(url).hash.slice(1)).get('connect')! }
function connect(url: string, token = secret(url)): Promise<Response> {
  return fetch(new URL('/neurix/connect', url), { method: 'POST', headers: {
    'Content-Type': 'application/json', Origin: new URL(url).origin,
  }, body: JSON.stringify({ token }) })
}
function cookie(response: Response): string { return response.headers.get('set-cookie')!.split(';')[0]! }
function admitted(url: string, value: string): PeerScope {
  const result = ctx.connection.admit({ headers: { host: new URL(url).host, cookie: value } })
  if ('rejection' in result) throw new Error('Phone session was not admitted')
  return result.peer
}
async function reload(config: { publicUrl?: string; autoConnect?: boolean; sessionMaxAgeMs?: number; maxPhoneSessions?: number } = {}) {
  for (const fiber of [...(ctx.registry.get(Mobile)?.fibers ?? [])]) await fiber.dispose()
  const spy = vi.spyOn(WebServer.prototype, 'listen')
  await ctx.plugin(Mobile, { port: 0, ...config })
  for (const fiber of [...(ctx.registry.get(MobileAccess)?.fibers ?? [])]) await fiber.await()
  return spy
}
function invocation(peer: PeerScope): RemoteInvocation {
  return { request: { namespace: 'mobileAccess', method: 'describe', args: {} }, service: 'mobileAccess', peer, signal: signal(),
    uplink() { throw new Error('Fixture does not open an uplink') } }
}

it('admits a phone by the random link without exposing the application to a bare URL', async () => {
  ctx.connection.fetch.register({ path: '/api/probe', methods: ['GET'], requestBody: 'buffered',
    fetch() { return Promise.resolve(new Response('EXISTING_AGENT')) } })
  const url = await open()
  const page = await fetch(url)
  expect(page.headers.get('cache-control')).toBe('no-store')
  const html = await page.text()
  expect(html).toContain('Phone connection')
  expect(html).not.toContain(secret(url))
  expect(html).not.toContain('type="password"')
  expect((await fetch(new URL('/api/probe', url))).status).toBe(401)
  expect((await connect(url, 'x'.repeat(43))).status).toBe(401)
  const result = await connect(url)
  expect(result.status).toBe(204)
  expect(result.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict')
  const value = cookie(result)
  expect((await fetch(new URL('/api/probe', url), { headers: { Cookie: value } })).status).toBe(200)
  expect(await (await fetch(new URL('/', url), { headers: { Cookie: value } })).text()).toBe('SAME_HOST_APP')
  expect(admitted(url, value).signal.aborted).toBe(false)
  expect((await fetch(new URL('/api/probe', url), { headers: { Cookie: value, Origin: 'https://untrusted.test' } })).status).toBe(403)
})

it('preserves the link across reconnects and plugin restarts and revokes old browser cookies', async () => {
  const url = await open()
  const original = secret(url)
  const first = cookie(await connect(url))
  const peer = admitted(url, first)
  expect((await ctx.mobileAccess.open('127.0.0.1', signal())).connection?.url).toBe(url)
  await ctx.mobileAccess.close()
  expect(peer.signal.aborted).toBe(true)
  expect(secret(await open())).toBe(original)
  await reload()
  const next = await open()
  expect(secret(next)).toBe(original)
  expect(ctx.connection.admit({ headers: { host: new URL(next).host, cookie: first } })).toEqual({ rejection: 401 })
  expect((await connect(next, original)).status).toBe(204)
})

it('rotates the link, revokes all existing phones immediately, and refuses the previous secret', async () => {
  const url = await open()
  const a = cookie(await connect(url))
  const b = cookie(await connect(url))
  const pa = admitted(url, a)
  const pb = admitted(url, b)
  const next = (await ctx.mobileAccess.regenerate(signal())).connection!.url
  expect(secret(next)).not.toBe(secret(url))
  expect(pa.signal.aborted).toBe(true)
  expect(pb.signal.aborted).toBe(true)
  expect((await connect(url)).status).toBe(401)
  expect((await connect(next)).status).toBe(204)
  expect(ctx.connection.admit({ headers: { host: new URL(url).host, cookie: a } })).toEqual({ rejection: 401 })
})

it('does not publish an uncommitted replacement link when credential persistence fails', async () => {
  const url = await open()
  const value = cookie(await connect(url))
  const peer = admitted(url, value)
  vi.spyOn(LinkStore.prototype, 'save').mockRejectedValueOnce(new Error('fixture disk unavailable'))
  await expect(ctx.mobileAccess.regenerate(signal())).rejects.toThrow('fixture disk unavailable')
  expect(ctx.mobileAccess.describe().connection?.url).toBe(url)
  expect(peer.signal.aborted).toBe(false)
  expect((await connect(url)).status).toBe(204)
})

it('hides link management from phones and refuses phone rotation, enable, and disable calls', async () => {
  const url = await open()
  const peer = admitted(url, cookie(await connect(url)))
  const phone = ctx.extend({ invocation: invocation(peer) }).mobileAccess
  expect(phone.describe()).toMatchObject({ phone: true, networks: [] })
  expect(phone.describe().connection).toBeUndefined()
  expect(() => phone.open('127.0.0.1', signal())).toThrow(expect.objectContaining({ code: 'mobile-access/computer-required' }))
  expect(() => phone.regenerate(signal())).toThrow(expect.objectContaining({ code: 'mobile-access/computer-required' }))
  expect(() => phone.close()).toThrow(expect.objectContaining({ code: 'mobile-access/computer-required' }))
  expect(ctx.extend({ invocation: invocation(ctx.connection.browserPeer) }).mobileAccess.describe().phone).toBe(false)
  await ctx.mobileAccess.regenerate(signal())
  expect(() => phone.close()).toThrow(expect.objectContaining({ code: 'mobile-access/computer-required' }))
})

it('disconnects only the requesting phone and leaves the other phone and local Host running', async () => {
  const url = await open()
  const a = cookie(await connect(url))
  const b = cookie(await connect(url))
  const peer = admitted(url, a)
  const endpoint = new URL('/neurix/disconnect', url)
  expect((await fetch(endpoint)).status).toBe(405)
  expect((await fetch(endpoint, { method: 'POST' })).status).toBe(401)
  const result = await fetch(endpoint, { method: 'POST', headers: { Cookie: a, Origin: new URL(url).origin } })
  expect(result.status).toBe(204)
  expect(result.headers.get('set-cookie')).toContain('Max-Age=0')
  expect(peer.signal.aborted).toBe(true)
  expect(admitted(url, b).signal.aborted).toBe(false)
  expect(ctx.mobileAccess.describe().connection?.url).toBe(url)
})

it('rejects malformed, oversized, forged, cross-origin, and wrong-authority requests', async () => {
  const url = await open()
  const endpoint = new URL('/neurix/connect', url)
  expect((await fetch(endpoint)).status).toBe(405)
  expect((await fetch(endpoint, { method: 'POST', body: 'fixture' })).status).toBe(405)
  expect((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status).toBe(401)
  expect((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(4097) })).status).toBe(413)
  expect((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.test' }, body: JSON.stringify({ token: secret(url) }) })).status).toBe(403)
  expect((await fetch(new URL('/neurix/connect', ctx.webServer.getOrigin()), { method: 'POST' })).status).toBe(403)
  expect(ctx.connection.admit({ headers: new Headers({ host: new URL(url).host, cookie: 'neurix-phone-forged=fixture' }) })).toEqual({ rejection: 401 })
  const chinese = await fetch(url, { headers: { 'Accept-Language': 'zh-CN' } })
  expect(await chinese.text()).toContain('连接 Neurix')
})

it('cancels before binding, rejects missing interfaces, and closes without stopping the local Host', async () => {
  await expect(ctx.mobileAccess.open('192.0.2.1', signal())).rejects.toMatchObject({ code: 'mobile-access/network-unavailable' })
  await expect(ctx.mobileAccess.open('127.0.0.1', AbortSignal.abort())).rejects.toBeDefined()
  await expect(ctx.mobileAccess.regenerate(signal())).rejects.toMatchObject({ code: 'mobile-access/network-unavailable' })
  const url = await open()
  await ctx.mobileAccess.close()
  await ctx.mobileAccess.close()
  await expect(fetch(url)).rejects.toThrow()
  const local = await fetch(ctx.connection.authenticatedUrl(ctx.webServer.getOrigin()), { redirect: 'manual' })
  expect(local.status).toBe(303)
})

it('joins canceled QR acquisition and releases its listener before reporting failure', async () => {
  const entered = Promise.withResolvers<undefined>()
  const released = Promise.withResolvers<undefined>()
  vi.spyOn(qrWriter, 'toDataURL').mockImplementation(async () => { entered.resolve(undefined); await released.promise; return 'data:image/png;base64,fixture' })
  const controller = new AbortController()
  const pending = ctx.mobileAccess.open('127.0.0.1', controller.signal)
  const refusal = expect(pending).rejects.toBeDefined()
  await entered.promise
  controller.abort()
  released.resolve(undefined)
  await refusal
  expect(ctx.mobileAccess.describe().connection).toBeUndefined()
})

it('joins an in-flight open at disposal and refuses subsequent operations', async () => {
  const entered = Promise.withResolvers<undefined>()
  const released = Promise.withResolvers<undefined>()
  vi.spyOn(qrWriter, 'toDataURL').mockImplementation(async () => { entered.resolve(undefined); await released.promise; return 'data:image/png;base64,fixture' })
  const controller = ctx.mobileAccess
  const pending = controller.open('127.0.0.1', signal())
  const refusal = expect(pending).rejects.toMatchObject({ code: 'mobile-access/closing' })
  await entered.promise
  const fiber = [...(ctx.registry.get(MobileAccess)?.fibers ?? [])][0]!
  const stopping = Promise.withResolvers<undefined>()
  const off = ctx.on('internal/status', (subject) => {
    if (subject === fiber && subject.state === FiberState.UNLOADING) stopping.resolve(undefined)
  })
  const unloading = fiber.dispose()
  await stopping.promise
  released.resolve(undefined)
  await refusal
  await unloading
  off()
  await expect(controller.close()).rejects.toMatchObject({ code: 'mobile-access/closing' })
})

it('streams the initial state and committed rotations until canceled', async () => {
  const controller = new AbortController()
  const stream = ctx.mobileAccess.watch(controller.signal)[Symbol.asyncIterator]()
  expect((await stream.next()).value).toMatchObject({ phone: false })
  const url = await open()
  expect((await stream.next()).value).toMatchObject({ connection: { url } })
  const replacement = (await ctx.mobileAccess.regenerate(signal())).connection!.url
  expect((await stream.next()).value).toMatchObject({ connection: { url: replacement } })
  controller.abort()
  expect((await stream.next()).done).toBe(true)
})

it('limits phone sessions and expires Peers without invalidating the saved link', async () => {
  await reload({ sessionMaxAgeMs: 1000, maxPhoneSessions: 2 })
  const url = await open()
  let clock = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  timerFixture.controlled = true
  const a = cookie(await connect(url))
  const pa = admitted(url, a)
  clock += 500
  const b = cookie(await connect(url))
  const pb = admitted(url, b)
  expect((await connect(url)).status).toBe(429)
  clock += 500
  const expired = new Promise<void>((resolve) => { pa.signal.addEventListener('abort', () => { resolve() }, { once: true }) })
  for (const callback of [...timerFixture.callbacks.values()]) callback()
  await expired
  expect(pa.signal.aborted).toBe(true)
  expect(pb.signal.aborted).toBe(false)
  expect((await connect(url)).status).toBe(204)
  expect(ctx.mobileAccess.describe().connection?.url).toBe(url)
})

it.each(['http://agent.example.test', 'https://user:secret@agent.example.test', 'https://agent.example.test/path',
  'https://agent.example.test/?token=secret', 'https://agent.example.test/#fragment'])('rejects an unsafe public origin: %s', (publicUrl) => {
  expect(() => Mobile.Config({ publicUrl })).toThrow()
})

function forwarded(origin: string, host: string, token: string, cookieValue?: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ token })
    const req = httpRequest(new URL('/neurix/connect', origin), { method: 'POST', headers: {
      Host: host, Origin: 'https://' + host, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
      ...cookieValue === undefined ? {} : { Cookie: cookieValue },
    } }, (response) => {
      response.resume()
      response.on('end', () => { resolve(new Response(null, { status: response.statusCode!, headers: {
        ...response.headers['set-cookie'] === undefined ? {} : { 'set-cookie': response.headers['set-cookie'].join(',') },
      } })) })
      response.on('error', reject)
    })
    req.on('error', reject)
    req.end(body)
  })
}

it('advertises the HTTPS relay, binds only loopback, and requires its exact public authority', async () => {
  const spy = await reload({ publicUrl: 'https://agent.example.test/' })
  await expect(ctx.mobileAccess.open('192.0.2.1', signal())).rejects.toMatchObject({ code: 'mobile-access/network-unavailable' })
  const url = await open()
  expect(new URL(url).origin).toBe('https://agent.example.test')
  expect(spy).toHaveBeenCalledWith({ host: '127.0.0.1', port: 0 })
  const result = spy.mock.results[0]!
  if (result.type !== 'return') throw new Error('Backend did not bind')
  const listener = await result.value
  const response = await forwarded(listener.origin, 'agent.example.test', secret(url))
  expect(response.status).toBe(204)
  expect(response.headers.get('set-cookie')).toContain('; Secure')
  expect((await forwarded(listener.origin, 'wrong.example.test', secret(url))).status).toBe(403)
})

it('restores the saved internet link on restart while respecting an explicit disable', async () => {
  await reload({ publicUrl: 'https://agent.example.test/', autoConnect: true })
  const url = ctx.mobileAccess.describe().connection!.url
  await reload({ publicUrl: 'https://agent.example.test/', autoConnect: true })
  expect(ctx.mobileAccess.describe().connection!.url).toBe(url)
  await ctx.mobileAccess.close()
  await reload({ publicUrl: 'https://agent.example.test/', autoConnect: true })
  expect(ctx.mobileAccess.describe().connection).toBeUndefined()
  expect((await ctx.mobileAccess.open('127.0.0.1', signal())).connection!.url).toBe(url)
})
