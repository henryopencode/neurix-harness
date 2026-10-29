/** Network choices and owner-only phone connection details. @module */

/** A current IPv4 interface the owner may expose. */
export interface MobileNetwork {
  name: string
  host: string
}

/** Current phone access; connection links require the bound owner's account login. */
export interface MobileAccessState {
  /** Internet mode uses a reverse proxy and a loopback backend. */
  mode?: 'lan' | 'internet'
  networks: MobileNetwork[]
  account: NeurixAccountState
  connection?: { url: string; qrCode: string; encrypted: boolean }
}

/** Neurix account state; passwords and derived keys never cross this result. */
export interface NeurixAccountState {
  configured: boolean
  signedIn: boolean
  username?: string
  /** True when the account request comes from an authenticated phone session. */
  phone?: boolean
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Network choice disappeared before binding. */
    'mobile-access/network-unavailable': Record<string, never>
    /** Activation is shutting down. */
    'mobile-access/closing': Record<string, never>
    /** No signed-in Neurix owner authorizes network access. */
    'neurix-account/sign-in-required': Record<string, never>
    /** Account input failed validation. */
    'neurix-account/invalid-input': Record<string, never>
    /** Credentials do not match the device's bound owner. */
    'neurix-account/invalid-credentials': Record<string, never>
    /** An owner account already exists on this Host. */
    'neurix-account/already-configured': Record<string, never>
    /** Too many failed login attempts; retry after the cooldown. */
    'neurix-account/rate-limited': Record<string, never>
    /** Phone logout uses the independent HTTP route so it can revoke its own Peer safely. */
    'neurix-account/device-logout-required': Record<string, never>
  }
}
