/** Credential-store corruption, crypto failures, and absent-owner authorization fail closed. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AccountStore } from '../src/account-store.ts'

const cryptoFailure = vi.hoisted(() => ({ enabled: false }))
vi.mock('node:crypto', async (load) => {
  const actual = await load<typeof import('node:crypto')>()
  return { ...actual, scrypt(password: string, salt: string, length: number, callback: (error: Error | null, value: Buffer) => void) {
    if (cryptoFailure.enabled) callback(new Error('crypto unavailable'), Buffer.alloc(0))
    else actual.scrypt(password, salt, length, callback)
  } }
})

let ctx: Context
let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'neurix-account-store-'))
  ctx = new Context()
  await ctx.plugin(Credentials, { dshHome: root, watch: false })
})
afterEach(async () => {
  cryptoFailure.enabled = false
  try { await ctx.fiber.dispose() } finally { await rm(root, { recursive: true, force: true }) }
})

function store(): AccountStore {
  return new AccountStore(ctx.credentials, { failedAttempts: 5, cooldownMs: 1000, pendingAttempts: 8 })
}

it('does not create authorization when the owner does not exist', async () => {
  const account = store()
  await account.load()
  expect(await account.signOut()).toEqual({ configured: false, signedIn: false })
  await expect(account.authenticate('unknown.owner', 'synthetic-test-password', true))
    .rejects.toMatchObject({ code: 'neurix-account/invalid-credentials' })
})

it('rejects an account record owned by the wrong credential kind', async () => {
  await ctx.credentials.modifyRecord(credentialKey('neurix-account', 'owner'), () => Promise.resolve({ kind: 'api-key', key: 'fixture' }))
  await expect(store().load()).rejects.toThrow('unsupported type')
})

it('preserves an unconfigured account when key derivation fails', async () => {
  const account = store()
  cryptoFailure.enabled = true
  await expect(account.register('test.owner', 'synthetic-test-password')).rejects.toThrow('crypto unavailable')
  expect(account.describe().configured).toBe(false)
})
