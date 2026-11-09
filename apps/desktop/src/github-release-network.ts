/** Bounded metadata reads share cancellation with their owning update operation. */
import { setTimeout as delay } from 'node:timers/promises'
import type { GithubReleaseRequest } from './github-release-transfer.ts'

/** A connection or transient HTTP failure eligible for a bounded retry or alternate asset route. */
export class GithubReleaseNetworkError extends Error {
  /** @param cause - Failed connection or transient HTTP response. */
  constructor(cause: unknown) { super(cause instanceof Error ? cause.message : String(cause), { cause }) }
}

interface TextOptions {
  request: GithubReleaseRequest
  url: string
  signal: AbortSignal
  timeoutMs: number
  maxBytes: number
  label: string
  headers?: Record<string, string>
  allowNotFound?: boolean
}

/**
 * Read bounded text with up to three attempts inside one total deadline.
 * @param options - Owner-selected URL, byte limit, deadline, and cancellation; optional 404 handling returns undefined.
 * @returns Complete UTF-8 text, or undefined for an explicitly allowed 404.
 * @throws On cancellation, deadline, permanent HTTP failure, excessive bytes, or exhausted connection attempts.
 */
export async function readGithubReleaseText(options: TextOptions): Promise<string | undefined> {
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)])
  for (let attempt = 1; ; attempt++) {
    signal.throwIfAborted()
    const connection = new AbortController()
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      let response: Response
      try {
        response = await options.request(options.url, { signal: AbortSignal.any([signal, connection.signal]),
          ...(options.headers === undefined ? {} : { headers: options.headers }) })
      } catch (error) { throw new GithubReleaseNetworkError(error) }
      if (response.body !== null) reader = response.body.getReader()
      if (response.status === 404 && options.allowNotFound === true) return undefined
      if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
        throw new GithubReleaseNetworkError(new Error(`${options.label} returned HTTP ${response.status}`))
      }
      if (!response.ok) throw new Error(`${options.label} returned HTTP ${response.status}`)
      const chunks: Uint8Array[] = []
      let size = 0
      while (reader !== undefined) {
        signal.throwIfAborted()
        let chunk: ReadableStreamReadResult<Uint8Array>
        try { chunk = await reader.read() } catch (error) { throw new GithubReleaseNetworkError(error) }
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > options.maxBytes) throw new Error(`${options.label} exceeds its size limit`)
        chunks.push(chunk.value)
      }
      signal.throwIfAborted()
      return Buffer.concat(chunks).toString('utf8')
    } catch (error) {
      options.signal.throwIfAborted()
      if (signal.aborted) throw new GithubReleaseNetworkError(signal.reason)
      if (!(error instanceof GithubReleaseNetworkError) || attempt >= 3) throw error
    } finally {
      connection.abort()
      if (reader !== undefined) {
        try { await reader.cancel() } catch (_error) { /* An interrupted connection may already have closed its stream. */ }
        reader.releaseLock()
      }
    }
    try { await delay(250 * attempt, undefined, { signal }) }
    catch (error) { options.signal.throwIfAborted(); throw new GithubReleaseNetworkError(error) }
  }
}
