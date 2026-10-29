/** Single-owner Neurix account persisted in the existing private credential provider. @module */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { credentialKey, type CredentialProvider, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { NeurixAccountState } from './types.ts'

const derive = (password: string, salt: string): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(password, salt, 64, (error, value) => { if (error) reject(error); else resolve(value) })
})
const key = credentialKey('neurix-account', 'owner')
const ownerSchema = z.object({
  version: z.literal(1), username: z.string().min(3).max(80),
  salt: z.string().regex(/^[0-9a-f]{32}$/), passwordHash: z.string().regex(/^[0-9a-f]{128}$/), signedIn: z.boolean(),
})
type Owner = z.infer<typeof ownerSchema>

function readOwner(record: CredentialRecord | undefined): Owner | undefined {
  if (record === undefined) return undefined
  if (record.kind !== 'grant') throw new Error('Neurix account credential record has an unsupported type')
  return ownerSchema.parse(record.payload)
}

/** The credential record is the sole account authority; input and authentication are serialized. */
export class AccountStore {
  private owner: Owner | undefined
  private tail: Promise<void> = Promise.resolve()
  private failures = 0
  private retryAt = 0
  private pending = 0
  private stopped = false

  constructor(private readonly credentials: CredentialProvider, private readonly limits: {
    failedAttempts: number
    cooldownMs: number
    pendingAttempts: number
  }) {}

  /**
   * Load and validate the private owner record before publishing account operations.
   * @returns after any stored account has been validated; malformed records fail activation.
   */
  async load(): Promise<void> {
    this.owner = readOwner(await this.credentials.readRecord(key))
  }

  /**
   * Read the current owner state.
   * @returns safe state without a password or password hash.
   */
  describe(): NeurixAccountState {
    return { configured: this.owner !== undefined, signedIn: this.owner?.signedIn === true,
      ...this.owner === undefined ? {} : { username: this.owner.username } }
  }

  /**
   * Create this trusted installation's first owner; public phone routes never expose this operation.
   * @param username - case-insensitive owner name.
   * @param password - password of 12–128 characters.
   * @returns safe account state after atomic credential persistence.
   */
  register(username: string, password: string): Promise<NeurixAccountState> {
    return this.serialize(async () => {
      const normalized = this.validate(username, password)
      const salt = randomBytes(16).toString('hex')
      const passwordHash = (await derive(password, salt)).toString('hex')
      const record = await this.credentials.modifyRecord(key, (current) => {
        if (current !== undefined) throw new RemoteError('neurix-account/already-configured', 'This computer already has a Neurix account', {})
        return Promise.resolve({ kind: 'grant', payload: { version: 1, username: normalized, salt, passwordHash, signedIn: true } })
      })
      this.owner = readOwner(record)
      return this.describe()
    })
  }

  /**
   * Check credentials, optionally signing this computer into its existing owner account.
   * @param username - entered owner name.
   * @param password - entered password; never retained.
   * @param signInHost - true for the trusted local login action; phone login never re-enables a signed-out Host.
   * @returns safe account state after verification and any requested persistence.
   */
  authenticate(username: string, password: string, signInHost: boolean): Promise<NeurixAccountState> {
    return this.serialize(async () => {
      if (Date.now() < this.retryAt) throw new RemoteError('neurix-account/rate-limited', 'Too many attempts; try again later', {})
      await this.load()
      const normalized = this.validate(username, password)
      const owner = this.owner
      const actual = await derive(password, owner?.salt ?? '00000000000000000000000000000000')
      if (owner === undefined || normalized !== owner.username || !timingSafeEqual(actual, Buffer.from(owner.passwordHash, 'hex'))) {
        if (++this.failures >= this.limits.failedAttempts) { this.retryAt = Date.now() + this.limits.cooldownMs; this.failures = 0 }
        throw new RemoteError('neurix-account/invalid-credentials', 'The account name or password is incorrect', {})
      }
      if (!owner.signedIn && !signInHost) throw new RemoteError('neurix-account/sign-in-required', 'Sign in on this computer first', {})
      if (signInHost) await this.setSignedIn(true)
      this.failures = 0
      this.retryAt = 0
      return this.describe()
    })
  }

  /**
   * Remove this Host's signed-in authorization.
   * @returns the persisted safe account state.
   */
  signOut(): Promise<NeurixAccountState> {
    return this.serialize(async () => { await this.setSignedIn(false); return this.describe() })
  }

  /** Stop accepting credentials and wait for every accepted password operation to settle. */
  async dispose(): Promise<void> {
    this.stopped = true
    await this.tail
  }

  private validate(username: string, password: string): string {
    const normalized = username.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9_.@+-]{2,79}$/.test(normalized) || password.length < 12 || password.length > 128) {
      throw new RemoteError('neurix-account/invalid-input', 'Use an account name of 3–80 characters and a password of 12–128 characters', {})
    }
    return normalized
  }

  private async setSignedIn(signedIn: boolean): Promise<void> {
    const record = await this.credentials.modifyRecord(key, (current) => {
      const owner = readOwner(current)
      if (owner === undefined) return Promise.resolve(undefined)
      return Promise.resolve({ kind: 'grant', payload: { ...owner, signedIn } })
    })
    this.owner = readOwner(record)
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    if (this.stopped || this.pending >= this.limits.pendingAttempts) {
      return Promise.reject(new RemoteError('neurix-account/rate-limited', 'Account login is busy; try again later', {}))
    }
    this.pending++
    const result = this.tail.then(operation).finally(() => { this.pending-- })
    this.tail = result.then(() => {}, () => {})
    return result
  }
}
