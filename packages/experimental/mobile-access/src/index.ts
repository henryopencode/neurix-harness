/** Phone access to an existing Desktop or Web Host. @module */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { MobileAccess } from './service.ts'
import { PhoneSessions } from './phone-sessions.ts'
import { LinkStore } from './link-store.ts'
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
  /** Enable internet access on first startup; subsequent startups respect the saved switch. */
  autoConnect?: boolean
  /** Absolute browser-session lifetime; the saved connection link remains valid. */
  sessionMaxAgeMs?: number
  /** Maximum simultaneous phone browser sessions. */
  maxPhoneSessions?: number
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
  sessionMaxAgeMs: Schema.natural().min(1000).max(2 ** 31 - 1).default(24 * 60 * 60 * 1000),
  maxPhoneSessions: Schema.natural().min(1).max(100).default(8),
})

/**
 * Register owner-controlled phone access without starting another Host or Agent.
 * @param ctx - running Web application.
 * @param config - listener, public origin, and phone-session limits.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = Config(config)
  if (resolved.autoConnect && resolved.publicUrl === undefined) throw new Error('autoConnect requires publicUrl')
  const store = new LinkStore(ctx.credentials)
  await store.load()
  await ctx.plugin(PhoneSessions, { store, sessionMaxAgeMs: resolved.sessionMaxAgeMs, maxPhoneSessions: resolved.maxPhoneSessions })
  ctx.plugin(MobileAccess, { config: resolved, store })
}
