/** Network choices and owner-only phone connection details. @module */

/** A current IPv4 interface the owner may expose. */
export interface MobileNetwork {
  name: string
  host: string
}

/** Phone connection state; the private link is returned only to the computer UI. */
export interface MobileAccessState {
  /** Internet mode uses a reverse proxy and a loopback backend. */
  mode?: 'lan' | 'internet'
  networks: MobileNetwork[]
  /** Phone callers cannot read, replace, or disable the computer's connection link. */
  phone: boolean
  connection?: { url: string; qrCode: string; encrypted: boolean }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Network choice disappeared before binding. */
    'mobile-access/network-unavailable': Record<string, never>
    /** Activation is shutting down. */
    'mobile-access/closing': Record<string, never>
    /** Connection state is unavailable until the browser reopens the plugin page. */
    'mobile-access/unavailable': Record<string, never>
    /** Only the trusted computer UI may manage its phone connection link. */
    'mobile-access/computer-required': Record<string, never>
  }
}
