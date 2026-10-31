/** Private updater connections retain Electron's system proxy and TLS handling. */
import { randomUUID } from 'node:crypto'
import { session, type Session } from 'electron'
import type { GithubReleaseRequest } from './github-release-transfer.ts'

type DownloadSession = Pick<Session, 'fetch' | 'closeAllConnections'>

/** Bounds updater network contexts so parallel ranges do not share one blocked HTTP/2 connection. */
export class GithubReleaseRequests {
  private readonly sessions: DownloadSession[] = []
  private readonly lifetime = new AbortController()
  private next = 0

  /** @param createSession - Create an in-memory Electron session with system proxy and certificate verification. */
  constructor(private readonly createSession: () => DownloadSession = () => session.fromPartition(`neurix-update-${randomUUID()}`, { cache: false })) {}

  /**
   * Fetch through one of at most eight private, memory-only network contexts.
   * @param url - Shell-owned release URL.
   * @param init - Transfer cancellation and optional byte range.
   * @returns Electron's streaming response, with the caller's cancellation retained.
   */
  readonly request: GithubReleaseRequest = async (url, init) => {
    this.lifetime.signal.throwIfAborted()
    const index = this.next++ % 8
    const network = this.sessions[index] ?? this.createSession()
    this.sessions[index] = network
    return network.fetch(url, { ...init, signal: AbortSignal.any([init.signal, this.lifetime.signal]) })
  }

  /** Abort pending requests and await closure of every owned connection. */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    const results = await Promise.allSettled(this.sessions.map(network => network.closeAllConnections()))
    const failures: unknown[] = []
    for (const result of results) {
      if (result.status === 'rejected') failures.push(result.reason)
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Updater connections could not all be closed')
  }
}
