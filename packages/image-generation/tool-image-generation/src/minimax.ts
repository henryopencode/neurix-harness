/** MiniMax native image dimensions, request fields, and application-status validation. @module */

import { ImageGenerationError, type ImageGenerationErrorCode } from './error.ts'
import type { GenerationRequest, ResolvedConfig } from './types.ts'

const ASPECT_RATIOS = ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9']

function dimensions(size: string | undefined, code: ImageGenerationErrorCode): Record<string, string | number> {
  if (size === undefined) return {}
  if (ASPECT_RATIOS.includes(size)) return { aspect_ratio: size }
  const match = /^(\d+)x(\d+)$/u.exec(size)
  if (match !== null) {
    const width = Number(match[1])
    const height = Number(match[2])
    if ([width, height].every(value => value >= 512 && value <= 2048 && value % 8 === 0)) return { width, height }
  }
  throw new ImageGenerationError('MiniMax size must be a supported aspect ratio or WIDTHxHEIGHT with dimensions from 512 to 2048, divisible by 8.', code)
}

/** Validate MiniMax options before configuration or a paid request is admitted.
 * @param options Optional size, quality, and output format.
 * @param code Configuration or request failure classification.
 */
export function assertMinimaxOptions(
  options: { readonly size?: string; readonly quality?: string; readonly outputFormat?: string },
  code: ImageGenerationErrorCode,
): void {
  dimensions(options.size, code)
  if (options.quality !== undefined || options.outputFormat !== undefined) {
    throw new ImageGenerationError('MiniMax does not accept quality or output format options. Leave these fields unset.', code)
  }
}

/** Build a native MiniMax generation request without sending OpenAI-only fields.
 * @param config Resolved model and response-format settings.
 * @param request Prompt, count, and dimensions admitted by the tool.
 * @returns MiniMax JSON request fields; rejects unsupported options before HTTP I/O.
 */
export function minimaxRequest(config: ResolvedConfig, request: GenerationRequest): Record<string, string | number> {
  assertMinimaxOptions(request, 'IMAGE_GENERATION_INVALID_REQUEST')
  if (Array.from(request.prompt).length > 1500 || request.count > 9) {
    throw new ImageGenerationError('MiniMax accepts prompts of at most 1500 characters and at most 9 images per request.', 'IMAGE_GENERATION_INVALID_REQUEST')
  }
  return {
    model: config.model, prompt: request.prompt, n: request.count,
    ...dimensions(request.size, 'IMAGE_GENERATION_INVALID_REQUEST'),
    ...config.responseFormat === undefined ? {} : { response_format: config.responseFormat === 'b64_json' ? 'base64' : 'url' },
  }
}

/** Validate MiniMax's application status and normalize native image arrays.
 * @param payload Parsed provider JSON; HTTP success alone does not imply generation success.
 * @returns OpenAI-style image entries for shared acquisition, or undefined for malformed fields.
 * @throws ImageGenerationError for a declared MiniMax failure, without echoing response text.
 */
export function minimaxImages(payload: Record<string, unknown>): Record<string, unknown>[] | undefined {
  const status = payload.base_resp
  if (typeof status !== 'object' || status === null || !('status_code' in status) || !Number.isSafeInteger(status.status_code)) return undefined
  if (status.status_code !== 0) {
    throw new ImageGenerationError(
      `MiniMax image generation failed (code ${String(status.status_code)}). Check the API key, model access, quota, and provider history before retrying.`,
      'IMAGE_GENERATION_PROVIDER_ERROR',
    )
  }
  const data = payload.data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
  const values: unknown = 'image_base64' in data ? data.image_base64 : 'image_urls' in data ? data.image_urls : undefined
  if (!Array.isArray(values) || !values.every((value: unknown) => typeof value === 'string')) return undefined
  return values.map((value: string) => 'image_base64' in data ? { b64_json: value } : { url: value })
}
