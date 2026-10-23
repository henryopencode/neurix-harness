/** Opt-in text-to-image tool over OpenAI-compatible or MiniMax endpoints and durable attachments. @module */

import type { Context, Fiber, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ImageGenerationError } from './error.ts'
import { isHttpUrl } from './http.ts'
import { generateImages } from './provider.ts'
import { assertMinimaxOptions } from './minimax.ts'
import type { ImageGenerationConfig, ImageGenerationProvider, GenerationRequest, ResolvedConfig } from './types.ts'

export { ImageGenerationError } from './error.ts'
export type { ImageGenerationErrorCode } from './error.ts'
export type { ImageGenerationProvider } from './types.ts'
/** Plain image-generation settings accepted by the Loader; generation starts disabled. */
export interface Options extends Partial<ImageGenerationConfig> {
  /** Expose generate_image after configuring a model and API key. */
  enabled?: boolean
}

/** Live settings; each tool invocation retains the configuration it started with. */
export interface Config {
  /** Whether generate_image is available to subsequent model requests. */
  enabled: Volatile<boolean>
  /** Wire protocol used for requests and responses. */
  provider: Volatile<ImageGenerationProvider>
  /** Complete HTTP(S) generation endpoint. */
  endpoint: Volatile<string>
  /** Write-only credential; absent while the plugin awaits configuration. */
  apiKey: Volatile<string | undefined>
  /** Image model or deployment id. */
  model: Volatile<string>
  /** Deadline including generation, downloading, and storage. */
  timeoutMs: Volatile<number>
  /** Per-call image count cap, also bounded by attachment policy. */
  maxImages: Volatile<number>
  /** Failed generation calls allowed per agent turn before cancelling that turn. */
  maxErrorsPerTurn: Volatile<number>
  /** Complete JSON response limit before decoding. */
  maxResponseBytes: Volatile<number>
  /** Optional provider-supported default size. */
  size: Volatile<string | undefined>
  /** Optional provider-supported default quality. */
  quality: Volatile<string | undefined>
  /** Optional response_format for compatible providers. */
  responseFormat: Volatile<'url' | 'b64_json' | undefined>
  /** Optional provider-supported output_format. */
  outputFormat: Volatile<'png' | 'jpeg' | 'webp' | undefined>
}

/** Loader plugin identity. */
export const name = 'tool-image-generation'

/** Services that register the tool and commit image results before logging. */
export const inject = ['tools', 'attachments']

/** Validated endpoint settings; models and credentials require explicit configuration. */
export const Config: z<Options, Config> = z.object({
  enabled: z.boolean().default(false).volatile(),
  provider: z.union(['openai', 'minimax'] as const).default('openai').volatile(),
  endpoint: z.string().default('https://api.openai.com/v1/images/generations').volatile(),
  apiKey: z.string().role('secret').volatile(),
  model: z.string().default('').volatile(),
  timeoutMs: z.number().default(180_000).volatile(),
  maxImages: z.number().default(4).volatile(),
  maxErrorsPerTurn: z.number().default(3).volatile(),
  maxResponseBytes: z.number().default(64 * 1024 * 1024).volatile(),
  size: z.string().volatile(),
  quality: z.string().volatile(),
  responseFormat: z.union(['url', 'b64_json'] as const).volatile(),
  outputFormat: z.union(['png', 'jpeg', 'webp'] as const).volatile(),
})

const IMAGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
    originalDimensions: {
      type: 'object', additionalProperties: false,
      properties: { width: { type: 'integer', required: true }, height: { type: 'integer', required: true } },
    },
  },
} as const

function assertConfig(config: ResolvedConfig, enabled: boolean): void {
  if (!isHttpUrl(config.endpoint)) {
    throw new ImageGenerationError('Configure image generation with a complete HTTP(S) endpoint without embedded credentials or a fragment.', 'IMAGE_GENERATION_INVALID_CONFIG')
  }
  if (/[\r\n]/u.test(config.apiKey) || enabled && (config.apiKey.trim() === '' || config.model.trim() === '')) {
    throw new ImageGenerationError('Configure an image-generation API key and model before enabling the plugin.', 'IMAGE_GENERATION_INVALID_CONFIG')
  }
  for (const field of ['timeoutMs', 'maxImages', 'maxErrorsPerTurn', 'maxResponseBytes'] as const) {
    if (!Number.isSafeInteger(config[field]) || config[field] < 1) {
      throw new ImageGenerationError(`Image generation ${field} must be a positive integer.`, 'IMAGE_GENERATION_INVALID_CONFIG')
    }
  }
  for (const field of ['size', 'quality'] as const) {
    if (config[field] !== undefined && config[field].trim() === '') {
      throw new ImageGenerationError(`Image generation ${field} must be non-empty when configured.`, 'IMAGE_GENERATION_INVALID_CONFIG')
    }
  }
  if (config.provider === 'minimax') assertMinimaxOptions(config, 'IMAGE_GENERATION_INVALID_CONFIG')
}

function resolveConfig(config: Config): ResolvedConfig {
  const size = config.size.get()
  const quality = config.quality.get()
  const responseFormat = config.responseFormat.get()
  const outputFormat = config.outputFormat.get()
  return {
    provider: config.provider.get(), endpoint: config.endpoint.get(), apiKey: config.apiKey.get() ?? '', model: config.model.get(),
    timeoutMs: config.timeoutMs.get(), maxImages: config.maxImages.get(),
    maxErrorsPerTurn: config.maxErrorsPerTurn.get(), maxResponseBytes: config.maxResponseBytes.get(),
    ...size === undefined ? {} : { size },
    ...quality === undefined ? {} : { quality },
    ...responseFormat === undefined ? {} : { responseFormat },
    ...outputFormat === undefined ? {} : { outputFormat },
  }
}

function resolveRequest(
  args: { readonly prompt: string; readonly count?: number; readonly size?: string; readonly quality?: string },
  config: ResolvedConfig,
  maxImages: number,
): GenerationRequest {
  const count = args.count ?? 1
  const size = args.size ?? config.size
  const quality = args.quality ?? config.quality
  if (args.prompt.trim() === '' || !Number.isSafeInteger(count) || count < 1 || count > maxImages
    || size !== undefined && size.trim() === '' || quality !== undefined && quality.trim() === '') {
    throw new ImageGenerationError(`Provide a non-empty image prompt and request 1 to ${maxImages} images; size and quality must be non-empty when supplied.`, 'IMAGE_GENERATION_INVALID_REQUEST')
  }
  return { prompt: args.prompt, count, ...size === undefined ? {} : { size }, ...quality === undefined ? {} : { quality } }
}

function registerTool(ctx: Context, resolved: ResolvedConfig): () => void {
  const sizePolicy = 'Set this argument only when the user explicitly requests a size or aspect ratio. '
    + (resolved.size === undefined
      ? 'Otherwise omit it to let the image provider choose.'
      : `Otherwise omit it to use the configured default ${resolved.size}.`)
  return ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate images from a text prompt using the configured image model. '
      + 'Describe the subject, composition, style, and desired text in the prompt. '
      + 'Embed generated images in your final response by copying the returned Markdown image references when available. '
      + 'Do not replace their destinations with placeholders such as "attachment".',
    parameters: {
      prompt: {
        type: 'string', required: true,
        description: resolved.provider === 'minimax'
          ? 'Detailed description of the images to create, at most 1500 characters.'
          : 'Detailed description of the images to create.',
      },
      count: { type: 'integer', description: 'Number of images to request; defaults to 1, bounded by deployment limits.' },
      size: {
        type: 'string',
        description: (resolved.provider === 'minimax'
          ? 'Optional size: 1:1, 16:9, 4:3, 3:2, 2:3, 3:4, 9:16, 21:9, or WIDTHxHEIGHT with each dimension from 512 to 2048 and divisible by 8. '
          : 'Optional image size accepted by the configured image model. ') + sizePolicy,
      },
      ...resolved.provider === 'openai' ? {
        quality: { type: 'string' as const, description: 'Optional quality accepted by the configured image model; otherwise uses its configured default.' },
      } : {},
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          requestedCount: { type: 'integer', required: true },
          images: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: { image: { ...IMAGE_SCHEMA, required: true }, path: { type: 'string' } },
            },
          },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `Generated ${value.images.length} of ${value.requestedCount} requested images.\n`
          + value.images.map(({ image, path }, index) => `Image ${index + 1}: ${image.width}x${image.height}, ${image.mediaType}, ${image.bytes} bytes.`
            + (path === undefined ? '' : `\nPath: ${path}\nMarkdown: ![Generated image ${index + 1}](<${encodeURI(path).replace(/[?#]/gu, encodeURIComponent)}>)`)).join('\n') },
        ...value.images.map(({ image }) => ({ type: 'image' as const, attachment: {
          ...image, attachmentId: AttachmentId(image.attachmentId),
        } satisfies ImageAttachmentRef })),
      ],
    },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => false,
    presentCall: args => ({ card: 'generic', title: args.prompt }),
    presentResult: (_args, result) => ({ card: 'generic', content: result.content }),
    async execute(args, exec) {
      const attachments = ctx.attachments
      const request = resolveRequest(args, resolved, Math.min(resolved.maxImages, attachments.imageLimits.maxImagesPerMessage))
      const encoded = await generateImages(resolved, request, attachments.imageLimits, exec.signal)
      exec.signal.throwIfAborted()
      let images: readonly ImageAttachmentRef[]
      try { images = await attachments.saveImages(encoded) }
      catch (error: unknown) {
        throw new ImageGenerationError(
          'Generated images could not be saved. No images were returned; check attachment storage and provider history before retrying.',
          'IMAGE_GENERATION_STORAGE_FAILED', { cause: error },
        )
      }
      exec.signal.throwIfAborted()
      return { requestedCount: request.count, images: images.map((image) => {
        const path = attachments.imageHostPath(image)
        return { image, ...path === undefined ? {} : { path } }
      }) }
    },
  }))
}

/**
 * Keep configuration editable while generation is disabled, and register the tool only when enabled.
 * @param ctx - tool registry and authoritative attachment store.
 * @param config - live Loader settings; enabling without credentials fails before persistence or HTTP I/O.
 */
export function apply(ctx: Context, config: Config): void {
  assertConfig(resolveConfig(config), config.enabled.get())
  const failures = new WeakMap<Agent, { turn: number; count: number }>()
  ctx.on('agent/pre-step', ({ agent, turn }, next) => {
    if (failures.get(agent)?.turn !== turn) failures.set(agent, { turn, count: 0 })
    return next()
  })
  ctx.on('tools/result', (exec, result) => {
    if (exec.name !== 'generate_image' || exec.agent === undefined || !result.isError || !config.enabled.get()) return
    const state = failures.get(exec.agent)
    if (state === undefined) return
    state.count++
    const limit = config.maxErrorsPerTurn.get()
    if (state.count >= limit) {
      exec.agent.cancel({
        kind: 'hook',
        reason: `Image generation failed ${limit} times in this turn. Stopped; check image-generation settings and the latest error before sending a new message.`,
      }, { keepInbox: true })
    }
  })
  ctx.on('internal/config', function (this: Fiber, _raw, next) {
    const raw: unknown = next()
    if (this === ctx.fiber) {
      const candidate = Config(raw as Options)
      assertConfig(resolveConfig(candidate), candidate.enabled.get())
    }
    return raw
  })
  let unregister: (() => void) | undefined
  const refresh = (): void => {
    unregister?.()
    unregister = undefined
    if (config.enabled.get()) unregister = registerTool(ctx, resolveConfig(config))
  }
  refresh()
  ctx.on('loader/volatile-update', refresh)
}
