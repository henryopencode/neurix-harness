/** OpenAI and MiniMax image acquisition; attachment storage owns full raster validation. @module */

import { fileTypeFromBuffer } from 'file-type'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { ImageAttachmentLimits, ImageMediaType, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { ImageGenerationError } from './error.ts'
import { isHttpUrl, requestBytes } from './http.ts'
import { minimaxImages, minimaxRequest } from './minimax.ts'
import type { GenerationRequest, ResolvedConfig } from './types.ts'

function invalidResponse(): ImageGenerationError {
  return new ImageGenerationError(
    'Image generation returned invalid image data. No images were returned; check provider logs before retrying.',
    'IMAGE_GENERATION_INVALID_RESPONSE',
  )
}

function imageEntries(bytes: Buffer, config: ResolvedConfig, count: number): Record<string, unknown>[] {
  let payload: unknown
  try { payload = JSON.parse(bytes.toString('utf8')) }
  catch (error: unknown) { throw new ImageGenerationError(invalidResponse().message, 'IMAGE_GENERATION_INVALID_RESPONSE', { cause: error }) }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw invalidResponse()
  let entries: unknown[] | undefined
  switch (config.provider) {
    case 'openai': entries = 'data' in payload && Array.isArray(payload.data) ? payload.data : undefined; break
    case 'minimax': entries = minimaxImages(payload as Record<string, unknown>); break
    /* v8 ignore next -- The Loader validates this closed protocol union before acquisition. */
    default: return assertNever(config.provider)
  }
  if (entries === undefined || entries.length < 1 || entries.length > count) throw invalidResponse()
  return entries.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw invalidResponse()
    return entry as Record<string, unknown>
  })
}

function requestBody(config: ResolvedConfig, request: GenerationRequest): Record<string, string | number> {
  switch (config.provider) {
    case 'minimax': return minimaxRequest(config, request)
    case 'openai': return {
      model: config.model, prompt: request.prompt, n: request.count,
      ...request.size === undefined ? {} : { size: request.size },
      ...request.quality === undefined ? {} : { quality: request.quality },
      ...config.responseFormat === undefined ? {} : { response_format: config.responseFormat },
      ...config.outputFormat === undefined ? {} : { output_format: config.outputFormat },
    }
    /* v8 ignore next -- The Loader validates this closed protocol union before acquisition. */
    default: return assertNever(config.provider)
  }
}

function imageType(value: string): value is ImageMediaType {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
}

async function imageBytes(entry: Record<string, unknown>, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  if (typeof entry.b64_json === 'string') {
    if (entry.b64_json.length > 4 * Math.ceil(maxBytes / 3)) {
      throw new ImageGenerationError('Generated image exceeds attachment byte limits. Request a smaller image.', 'IMAGE_GENERATION_LIMIT_EXCEEDED')
    }
    const bytes = Buffer.from(entry.b64_json, 'base64')
    if (bytes.length === 0 || bytes.toString('base64') !== entry.b64_json) throw invalidResponse()
    return bytes
  }
  if (typeof entry.url !== 'string' || !isHttpUrl(entry.url)) throw invalidResponse()
  // Provider image URLs may be signed; they receive no API key or generation request body.
  return requestBytes(entry.url, { headers: { accept: 'image/*' } }, maxBytes, signal)
}

/**
 * Generate and acquire one bounded image batch without retrying paid requests.
 * @param config - Loader-resolved credentials and provider settings.
 * @param request - validated prompt, image count, and resolved provider options.
 * @param limits - attachment admission bounds, enforced before storage.
 * @param signal - cancellation shared by POST and every image download.
 * @returns encoded image inputs in provider order; no attachment is stored here.
 * @throws ImageGenerationError for unusable provider results or exceeded bounds.
 */
export async function generateImages(
  config: ResolvedConfig,
  request: GenerationRequest,
  limits: ImageAttachmentLimits,
  signal: AbortSignal,
): Promise<SaveImageAttachment[]> {
  const bytes = await requestBytes(config.endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(requestBody(config, request)),
  }, config.maxResponseBytes, signal)
  const entries = imageEntries(bytes, config, request.count)
  const images: SaveImageAttachment[] = []
  let remaining = limits.maxMessageImageBytes
  for (const entry of entries) {
    signal.throwIfAborted()
    const maxBytes = Math.min(limits.maxImageBytes, remaining)
    const data = await imageBytes(entry, maxBytes, signal)
    if (data.byteLength > maxBytes) {
      throw new ImageGenerationError('Generated images exceed attachment byte limits. Request fewer or smaller images.', 'IMAGE_GENERATION_LIMIT_EXCEEDED')
    }
    let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>
    try { detected = await fileTypeFromBuffer(data) }
    catch (error: unknown) { throw new ImageGenerationError(invalidResponse().message, 'IMAGE_GENERATION_INVALID_RESPONSE', { cause: error }) }
    if (detected === undefined || !imageType(detected.mime) || !limits.mediaTypes.includes(detected.mime)) throw invalidResponse()
    remaining -= data.byteLength
    images.push({ data, mediaType: detected.mime, name: `generated-${images.length + 1}.${detected.ext}` })
  }
  return images
}
