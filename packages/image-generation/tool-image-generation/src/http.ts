/** Bounded, cancellable HTTP acquisition without redirects or response-body diagnostics. @module */

import { ImageGenerationError } from './error.ts'

/**
 * Accept a complete HTTP(S) URL without embedded credentials or fragments.
 * @param value - configured endpoint or provider-returned image URL.
 * @returns whether fetch can use the URL without implicit credentials.
 */
export function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return (url.protocol === 'https:' || url.protocol === 'http:')
    && url.username === '' && url.password === '' && url.hash === ''
}

/**
 * Acquire a complete response within its byte budget. Redirects are rejected before a second request.
 * @param url - already validated endpoint or image URL.
 * @param init - request method, body, and headers; only generation requests carry credentials.
 * @param maxBytes - complete response-byte ceiling.
 * @param signal - calling tool's cancellation/deadline signal.
 * @returns bounded response bytes after a successful HTTP status.
 * @throws ImageGenerationError for HTTP, transport, or size failures; cancellation retains its signal reason.
 */
export async function requestBytes(
  url: string,
  init: RequestInit,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  signal.throwIfAborted()
  let response: Response
  try {
    response = await fetch(url, { ...init, redirect: 'error', signal })
  } catch (error: unknown) {
    signal.throwIfAborted()
    throw new ImageGenerationError(
      'Image generation request failed. The provider may have processed it; check provider history before retrying.',
      'IMAGE_GENERATION_PROVIDER_ERROR', { cause: error },
    )
  }
  if (!response.ok) {
    await response.body?.cancel()
    signal.throwIfAborted()
    throw new ImageGenerationError(
      `Image generation returned HTTP ${response.status}. Check the endpoint, credentials, model access, and provider logs before retrying.`,
      'IMAGE_GENERATION_PROVIDER_ERROR',
    )
  }
  if (response.body === null) {
    throw new ImageGenerationError('Image generation returned an empty response. Check provider logs before retrying.', 'IMAGE_GENERATION_INVALID_RESPONSE')
  }
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for await (const chunk of response.body) {
      signal.throwIfAborted()
      total += chunk.byteLength
      if (total > maxBytes) {
        throw new ImageGenerationError(
          `Image generation response exceeds the ${maxBytes}-byte limit. Request fewer or smaller images, and check provider history before retrying.`,
          'IMAGE_GENERATION_LIMIT_EXCEEDED',
        )
      }
      chunks.push(chunk)
    }
  } catch (error: unknown) {
    signal.throwIfAborted()
    if (error instanceof ImageGenerationError) throw error
    throw new ImageGenerationError(
      'Image generation response could not be read. The provider may have processed it; check provider history before retrying.',
      'IMAGE_GENERATION_PROVIDER_ERROR', { cause: error },
    )
  }
  signal.throwIfAborted()
  return Buffer.concat(chunks, total)
}
