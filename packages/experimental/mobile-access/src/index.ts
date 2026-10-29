/** Phone access to an existing Desktop or Web Host. @module */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { MobileAccess } from './service.ts'
import { NeurixAccount } from './account.ts'
import { AccountStore } from './account-store.ts'
import type {} from '@deepseek-ai/dsh-credentials'

/** Cordis plugin identity. */
export const name = 'experimental-mobile-access'
/** Sessions, browser credentials, and routes remain owned by the existing application. */
export const inject = ['webServer', 'connection', 'typert', 'credentials']

/** Deployment-owned listener, public endpoint, and authentication limits. */
export interface Config {
  /** Phone access port; zero requests an available port instead of a stable bookmark. */
  port?: number
  /** HTTPS origin of the reverse proxy; configures a loopback-only backend. */
  publicUrl?: string
  /** Restore remote access at startup and after local sign-in; requires publicUrl. */
  autoConnect?: boolean
  /** Consecutive failed passwords before a login cooldown. */
  loginFailedAttempts?: number
  /** Login cooldown after repeated credential failures. */
  loginCooldownMs?: number
  /** Absolute phone login lifetime; reconnecting does not extend it. */
  sessionMaxAgeMs?: number
  /** Maximum simultaneous phone browser logins. */
  maxPhoneSessions?: number
  /** Maximum queued password operations while a login is being checked. */
  maxPendingLogins?: number
}

/** Validated limits with an optional public endpoint. */
export type ResolvedConfig = Required<Omit<Config, 'publicUrl'>> & Pick<Config, 'publicUrl'>

function publicOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('publicUrl must be an HTTPS origin without credentials, a path, query, or fragment')
  }
  return url.href
}

/** Validate connection settings before registration. */
export const Config: Schema<Config, ResolvedConfig> = Schema.object({
  port: Schema.natural().max(65535).default(3081),
  publicUrl: Schema.transform(Schema.string(), publicOrigin),
  autoConnect: Schema.boolean().default(false),
  loginFailedAttempts: Schema.natural().min(1).default(5),
  loginCooldownMs: Schema.natural().min(1).max(2 ** 31 - 1).default(60_000),
  sessionMaxAgeMs: Schema.natural().min(1000).max(2 ** 31 - 1).default(24 * 60 * 60 * 1000),
  maxPhoneSessions: Schema.natural().min(1).max(100).default(8),
  maxPendingLogins: Schema.natural().min(1).max(100).default(8),
})

/**
 * Register owner-controlled phone access without starting another Host or Agent.
 * @param ctx - running Web application.
 * @param config - listener port.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = Config(config)
  if (resolved.autoConnect && resolved.publicUrl === undefined) throw new Error('autoConnect requires publicUrl')
  const store = new AccountStore(ctx.credentials, {
    failedAttempts: resolved.loginFailedAttempts, cooldownMs: resolved.loginCooldownMs, pendingAttempts: resolved.maxPendingLogins,
  })
  await store.load()
  ctx.effect(() => () => store.dispose(), 'neurix-account: password operations')
  await ctx.plugin(NeurixAccount, { store, sessionMaxAgeMs: resolved.sessionMaxAgeMs, maxPhoneSessions: resolved.maxPhoneSessions })
  ctx.plugin(MobileAccess, resolved)
}
