/** Bounded installer ranges retain written bytes across connection failures and settle before cleanup. */
import type { FileHandle } from 'node:fs/promises'

/** Shell-owned HTTP transport, including the installed application's system proxy settings. */
export type GithubReleaseRequest = (url: string, init: { signal: AbortSignal; headers?: Record<string, string> }) => Promise<Response>

interface TransferOptions {
  url: string
  size: number
  file: FileHandle
  request: GithubReleaseRequest
  signal: AbortSignal
  idleTimeoutMs: number
  progress: (received: number) => void
}

class ConnectionFailure extends Error {
  constructor(cause: unknown) { super(cause instanceof Error ? cause.message : String(cause), { cause }) }
}

/**
 * Write disjoint ranges with six workers and at most three connection attempts per range.
 * A server without range support uses one full response. Rejected transfers settle all workers.
 * The caller owns the file, its final checksum verification, and removal after failure.
 * @param options - Checked asset size, destination, transport, cancellation, and byte progress.
 * @returns Completion only after every expected byte has been written.
 */
export async function transferGithubRelease(options: TransferOptions): Promise<void> {
  const blockBytes = 1024 * 1024
  const stopped = new AbortController()
  const signal = AbortSignal.any([options.signal, stopped.signal])
  let received = 0

  const range = async (start: number, end: number): Promise<boolean> => {
    let position = start
    let fullResponse = false
    for (let attempt = 1; ; attempt++) {
      signal.throwIfAborted()
      const connection = new AbortController()
      const requestSignal = AbortSignal.any([signal, connection.signal])
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      let idle: ReturnType<typeof setTimeout> | undefined
      const refresh = (): void => {
        clearTimeout(idle)
        idle = setTimeout(() => { connection.abort(new Error('Update download timed out')) }, options.idleTimeoutMs)
      }
      try {
        refresh()
        let response: Response
        try {
          response = await options.request(options.url, { signal: requestSignal, headers: { Range: `bytes=${position}-${end}` } })
        } catch (error) { throw new ConnectionFailure(error) }
        if (response.body !== null) reader = response.body.getReader()
        if ([408, 500, 502, 503, 504].includes(response.status)) {
          throw new ConnectionFailure(new Error(`Installer download returned HTTP ${response.status}`))
        }
        if (response.status === 200 && position === 0) {
          fullResponse = true
          end = options.size - 1
        } else if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${position}-${end}/${options.size}`) {
          throw new Error(`Installer range response is invalid (HTTP ${response.status})`)
        }
        if (reader === undefined) throw new ConnectionFailure(new Error('Installer response has no body'))
        while (true) {
          signal.throwIfAborted()
          let chunk: ReadableStreamReadResult<Uint8Array>
          try { chunk = await reader.read() } catch (error) { throw new ConnectionFailure(error) }
          if (chunk.done) break
          refresh()
          if (position + chunk.value.byteLength > end + 1) throw new Error('Installer exceeds the requested byte range')
          let offset = 0
          while (offset < chunk.value.byteLength) {
            signal.throwIfAborted()
            const { bytesWritten } = await options.file.write(chunk.value, offset, chunk.value.byteLength - offset, position)
            if (bytesWritten === 0) throw new Error('Installer cache write made no progress')
            offset += bytesWritten
            position += bytesWritten
            received += bytesWritten
            options.progress(received)
          }
        }
        requestSignal.throwIfAborted()
        if (position !== end + 1) throw new ConnectionFailure(new Error('Installer connection ended before the requested range completed'))
        return fullResponse
      } catch (error) {
        signal.throwIfAborted()
        if (!(error instanceof ConnectionFailure) || attempt >= 3 || position > end) throw error
      } finally {
        clearTimeout(idle)
        connection.abort()
        if (reader !== undefined) {
          try { await reader.cancel() } catch (_error) { /* Failed connections can already have closed the stream. */ }
          reader.releaseLock()
        }
      }
    }
  }

  try {
    if (await range(0, Math.min(blockBytes, options.size) - 1)) return
    let next = blockBytes
    const worker = async (): Promise<void> => {
      try {
        while (next < options.size) {
          const start = next
          next += blockBytes
          await range(start, Math.min(next, options.size) - 1)
        }
      } catch (error) {
        stopped.abort(error)
        throw error
      }
    }
    await Promise.allSettled(Array.from({ length: 6 }, worker))
    signal.throwIfAborted()
  } finally { stopped.abort() }
}
