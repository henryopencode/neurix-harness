/** Connection credentials survive restart, retire account records, and reject corrupt persistence. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LinkStore } from '../src/link-store.ts'

let ctx: Context
let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'neurix-link-store-'))
  ctx = new Context()
  await ctx.plugin(Credentials, { dshHome: root, watch: false })
})
afterEach(async () => {
  vi.restoreAllMocks()
  try { await ctx.fiber.dispose() } finally { await rm(root, { recursive: true, force: true }) }
})

it('persists one random credential, checks it exactly, and preserves it when disabled', async () => {
  const store = new LinkStore(ctx.credentials)
  await store.load()
  expect(store.enabled).toBeUndefined()
  expect(store.accepts('x'.repeat(43))).toBe(false)
  const token = store.generate()
  await store.save(token, true)
  expect(store.accepts(token)).toBe(true)
  expect(store.accepts(token + 'x')).toBe(false)
  expect(store.accepts('x'.repeat(43))).toBe(false)
  const next = new LinkStore(ctx.credentials)
  await next.load()
  expect(next.token).toBe(token)
  await next.save(token, false)
  expect(next.accepts(token)).toBe(false)
  expect(next.token).toBe(token)
})

it('removes the plugin-owned retired account record without touching other credentials', async () => {
  const account = credentialKey('neurix-account', 'owner')
  const other = credentialKey('fixture-provider', 'fixture-key')
  await ctx.credentials.modifyRecord(account, () => Promise.resolve({ kind: 'grant', payload: { version: 1 } }))
  await ctx.credentials.modifyRecord(other, () => Promise.resolve({ kind: 'api-key', key: 'synthetic-test-key' }))
  await new LinkStore(ctx.credentials).load()
  expect(await ctx.credentials.readRecord(account)).toBeUndefined()
  expect(await ctx.credentials.readRecord(other)).toMatchObject({ kind: 'api-key' })
})

it.each([{ kind: 'api-key' as const, key: 'fixture' }, { kind: 'grant' as const, payload: { version: 99 } }])('refuses an invalid saved credential', async (record) => {
  await ctx.credentials.modifyRecord(credentialKey('mobile-access', 'link'), () => Promise.resolve(record))
  await expect(new LinkStore(ctx.credentials).load()).rejects.toThrow()
})

it('retains the previous credential after a failed commit', async () => {
  const store = new LinkStore(ctx.credentials)
  const token = store.generate()
  await store.save(token, true)
  vi.spyOn(ctx.credentials, 'modifyRecord').mockRejectedValueOnce(new Error('fixture write failed'))
  await expect(store.save(store.generate(), true)).rejects.toThrow('fixture write failed')
  expect(store.accepts(token)).toBe(true)
})
