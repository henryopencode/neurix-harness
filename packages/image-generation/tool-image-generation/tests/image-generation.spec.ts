/** Images API acquisition through the real tool registry and durable local attachment store. */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import * as fileType from 'file-type'
import * as plugin from '../src/index.ts'
import { requestBytes } from '../src/http.ts'
import type { Options } from '../src/index.ts'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

vi.mock('file-type', { spy: true })

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')
const JSON_IMAGE = { data: [{ b64_json: PNG.toString('base64') }] }
type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
let ctx: Context
let server: Server
let root: string
let endpoint: string
let handler: Handler
let requests: { path: string | undefined; authorization: string | undefined; body: unknown }[]

function json(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-image-generation-'))
  ctx = new Context()
  requests = []
  handler = (_req, res) => { json(res, JSON_IMAGE) }
  server = createServer((req, res) => {
    void (async () => {
      const parts: Buffer[] = []
      for await (const part of req) {
        const bytes: unknown = part
        if (!(bytes instanceof Uint8Array)) throw new Error('image fixture received a non-binary request chunk')
        parts.push(Buffer.from(bytes))
      }
      const text = Buffer.concat(parts).toString('utf8')
      requests.push({ path: req.url, authorization: req.headers.authorization, body: text === '' ? null : JSON.parse(text) })
      await handler(req, res)
    })().catch((error: unknown) => { res.destroy(error instanceof Error ? error : new Error('image fixture request failed', { cause: error })) })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('image fixture has no TCP address')
  endpoint = `http://127.0.0.1:${address.port}/images/generations`
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
})

afterEach(async () => {
  await ctx.fiber.dispose()
  vi.restoreAllMocks()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error === undefined) resolve(); else reject(error) })
    server.closeAllConnections()
  })
  await rm(root, { recursive: true, force: true })
})

async function mount(config: Options = {}, limits: Parameters<typeof LocalAttachmentStore.Config>[0] = {}) {
  await ctx.plugin(LocalAttachmentStore, { dshHome: root, ...limits })
  return ctx.plugin(plugin, { enabled: true, endpoint, apiKey: 'fixture-key', model: 'fixture-image-model', ...config }).await()
}

function call(args: unknown = { prompt: 'A red square' }, signal = new AbortController().signal) {
  return ctx.tools.execute({ name: 'generate_image', callId: ToolCallId('image-call'), arguments: args, signal })
}

describe('image generation', () => {
  it('keeps an unconfigured plugin editable without exposing the tool', async () => {
    await ctx.plugin(LocalAttachmentStore, { dshHome: root })
    const configuration = await liveConfig(ctx, plugin, { endpoint })
    const childApply = vi.fn()
    await configuration.fiber.ctx.plugin({ apply: childApply }, { unrelated: true }).await()
    expect(childApply.mock.calls[0]?.[1]).toEqual({ unrelated: true })
    expect(ctx.tools.schemas().map(tool => tool.name)).not.toContain('generate_image')
    await expect(configuration.update({ enabled: true })).rejects.toMatchObject({ code: 'IMAGE_GENERATION_INVALID_CONFIG' })
    expect(configuration.entry.options.config).toEqual({ endpoint })
    expect(ctx.tools.schemas().map(tool => tool.name)).not.toContain('generate_image')
    expect(requests).toHaveLength(0)
  })

  it('enables, reconfigures, and disables generation through live Loader settings', async () => {
    await ctx.plugin(LocalAttachmentStore, { dshHome: root })
    const configuration = await liveConfig(ctx, plugin, { endpoint })
    await configuration.update({ enabled: true, apiKey: 'fixture-key', model: 'fixture-image-model' })
    expect(ctx.tools.schemas().filter(tool => tool.name === 'generate_image')).toHaveLength(1)
    expect((await call()).isError).toBe(false)
    await configuration.update({ quality: 'high', responseFormat: 'b64_json', outputFormat: 'png' })
    expect(configuration.entry.fiber).toBe(configuration.fiber)
    expect((await call()).isError).toBe(false)
    expect(requests[1]?.body).toMatchObject({ quality: 'high', response_format: 'b64_json', output_format: 'png' })
    await expect(configuration.update({ apiKey: '', endpoint: 'invalid' })).rejects.toMatchObject({ code: 'IMAGE_GENERATION_INVALID_CONFIG' })
    expect(configuration.entry.options.config).toMatchObject({ apiKey: 'fixture-key', endpoint })
    await configuration.update({ enabled: false })
    expect(ctx.tools.schemas().map(tool => tool.name)).not.toContain('generate_image')
    await configuration.update({ enabled: true })
    expect(ctx.tools.schemas().filter(tool => tool.name === 'generate_image')).toHaveLength(1)
    await configuration.fiber.dispose()
    expect(ctx.tools.schemas().map(tool => tool.name)).not.toContain('generate_image')
  })

  it('retains the admitted configuration while an in-flight generation finishes', async () => {
    await ctx.plugin(LocalAttachmentStore, { dshHome: root })
    const configuration = await liveConfig(ctx, plugin, { enabled: true, endpoint, apiKey: 'fixture-key', model: 'original-model' })
    const reached = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    handler = async (_req, res) => { reached.resolve(undefined); await release.promise; json(res, JSON_IMAGE) }
    const pending = call()
    try {
      await reached.promise
      await configuration.update({ model: 'updated-model', enabled: false })
    } finally { release.resolve(undefined) }
    expect((await pending).isError).toBe(false)
    expect(requests[0]?.body).toMatchObject({ model: 'original-model' })
    await configuration.update({ enabled: true })
    expect((await call()).isError).toBe(false)
    expect(requests[1]?.body).toMatchObject({ model: 'updated-model' })
  })

  it('retains namespace injection when loaded and removes its tool on disposal', async () => {
    const loader = Object.create(Loader.prototype) as Loader
    expect('default' in plugin).toBe(false)
    expect(loader.unwrapExports(plugin)).toBe(plugin)
    const fiber = await mount()
    expect(ctx.tools.schemas().map(tool => tool.name)).toContain('generate_image')
    await fiber.dispose()
    expect(ctx.tools.schemas().map(tool => tool.name)).not.toContain('generate_image')
  })

  it('saves base64 images before returning durable references and host paths', async () => {
    await mount()
    const result = await call()
    expect(result.isError, JSON.stringify(result)).toBe(false)
    const image = result.content.find(part => part.type === 'image')
    if (image?.type !== 'image') throw new Error('generated image missing')
    const path = ctx.attachments.imageHostPath(image.attachment)
    if (path === undefined) throw new Error('generated image path missing')
    expect(await readFile(path)).toEqual(PNG)
    expect(Buffer.from((await ctx.attachments.readImage(image.attachment)).data)).toEqual(PNG)
    expect(result.content[0]).toEqual({ type: 'text', text: `Generated 1 of 1 requested images.\nImage 1: 1x1, image/png, ${PNG.length} bytes.\nPath: ${path}\nMarkdown: ![Generated image 1](<${encodeURI(path)}>)` })
    expect(result.value).toEqual({ requestedCount: 1, images: [{ image: image.attachment, path }] })
    expect(requests).toEqual([{ path: '/images/generations', authorization: 'Bearer fixture-key', body: { model: 'fixture-image-model', prompt: 'A red square', n: 1 } }])
  })

  it('returns a Markdown destination that preserves spaces, fragments, and percent signs in saved paths', async () => {
    await mount({}, { dshHome: join(root, 'images # %') })
    const result = await call()
    const image = result.content.find(part => part.type === 'image')
    const text = result.content.find(part => part.type === 'text')
    if (image?.type !== 'image' || text?.type !== 'text') throw new Error('generated image missing')
    const destination = /Markdown: !\[Generated image 1\]\(<([^>]+)>\)/u.exec(text.text)?.[1]
    expect(destination).toBeDefined()
    expect(destination).not.toMatch(/[ #]/u)
    expect(decodeURIComponent(destination!)).toBe(ctx.attachments.imageHostPath(image.attachment))
  })

  it('uses configured defaults unless a call explicitly requests a size or quality', async () => {
    await mount({ size: '1024x1024', quality: 'high', responseFormat: 'b64_json', outputFormat: 'png' })
    expect((await call({ prompt: 'Square', size: '1536x1024', quality: 'low' })).isError).toBe(false)
    expect(requests[0]?.body).toEqual({ model: 'fixture-image-model', prompt: 'Square', n: 1, size: '1536x1024', quality: 'low', response_format: 'b64_json', output_format: 'png' })
    await call()
    expect(requests[1]?.body).toMatchObject({ size: '1024x1024', quality: 'high' })
  })

  it('downloads URL results without sending the API key to the image URL', async () => {
    handler = (req, res) => {
      if (req.url === '/image.png') { res.end(PNG); return }
      json(res, { data: [{ url: new URL('/image.png', endpoint).href }] })
    }
    await mount({ responseFormat: 'url' })
    expect((await call()).isError).toBe(false)
    expect(requests[1]).toEqual({ path: '/image.png', authorization: undefined, body: null })
  })

  it('saves MiniMax base64 images and sends native pixel dimensions', async () => {
    handler = (_req, res) => { json(res, { base_resp: { status_code: 0 }, data: { image_base64: [PNG.toString('base64')] } }) }
    await mount({ provider: 'minimax', model: 'image-01', size: '1024x1024', responseFormat: 'b64_json' })
    const result = await call()
    expect(result.isError, JSON.stringify(result)).toBe(false)
    const image = result.content.find(part => part.type === 'image')
    if (image?.type !== 'image') throw new Error('MiniMax generated image missing')
    expect(Buffer.from((await ctx.attachments.readImage(image.attachment)).data)).toEqual(PNG)
    expect(requests[0]?.body).toEqual({
      model: 'image-01', prompt: 'A red square', n: 1, width: 1024, height: 1024, response_format: 'base64',
    })
    expect((await call({ prompt: 'A portrait', size: '2:3' })).isError).toBe(false)
    expect(requests[1]?.body).toMatchObject({ aspect_ratio: '2:3' })
    expect(requests[1]?.body).not.toHaveProperty('width')
    expect(requests[1]?.body).not.toHaveProperty('height')
  })

  it('honors requested ratios and uses live configured defaults when no ratio is requested', async () => {
    handler = (_req, res) => { json(res, { base_resp: { status_code: 0 }, data: { image_base64: [PNG.toString('base64')] } }) }
    await ctx.plugin(LocalAttachmentStore, { dshHome: root })
    const config = { enabled: true, provider: 'minimax', endpoint, apiKey: 'fixture-key', model: 'image-01' }
    const configuration = await liveConfig(ctx, plugin, { ...config, size: '16:9' })
    expect((await call({ prompt: 'A square', size: '1:1' })).isError).toBe(false)
    expect(requests[0]?.body).toMatchObject({ aspect_ratio: '1:1' })
    expect((await call({ prompt: 'A landscape' })).isError).toBe(false)
    expect(requests[1]?.body).toMatchObject({ aspect_ratio: '16:9' })
    await configuration.update({ size: '9:16' })
    expect((await call({ prompt: 'A portrait' })).isError).toBe(false)
    expect(requests[2]?.body).toMatchObject({ aspect_ratio: '9:16' })
    expect((await call({ prompt: 'A square', size: '1:1' })).isError).toBe(false)
    expect(requests[3]?.body).toMatchObject({ aspect_ratio: '1:1' })
    expect(ctx.tools.schemas().find(tool => tool.name === 'generate_image')?.parameters)
      .toHaveProperty('properties.size.description', expect.stringContaining('configured default 9:16'))
    expect(ctx.tools.schemas().find(tool => tool.name === 'generate_image')?.parameters)
      .toHaveProperty('properties.size.description', expect.stringContaining('only when the user explicitly requests'))
    await configuration.replace(config)
    expect((await call({ prompt: 'A landscape', size: '16:9' })).isError).toBe(false)
    expect(requests[4]?.body).toMatchObject({ aspect_ratio: '16:9' })
    expect((await call({ prompt: 'An image' })).isError).toBe(false)
    expect(requests[5]?.body).not.toHaveProperty('aspect_ratio')
    expect(requests[5]?.body).not.toHaveProperty('width')
    expect(requests[5]?.body).not.toHaveProperty('height')
  })

  it('updates supported model arguments when switching between OpenAI and MiniMax', async () => {
    await ctx.plugin(LocalAttachmentStore, { dshHome: root })
    const configuration = await liveConfig(ctx, plugin, { enabled: true, endpoint, apiKey: 'fixture-key', model: 'image-01', size: '1024x1024' })
    const schema = () => ctx.tools.schemas().find(tool => tool.name === 'generate_image')!.parameters
    expect(schema()).toHaveProperty('properties.quality')
    await configuration.update({ provider: 'minimax' })
    expect(schema()).not.toHaveProperty('properties.quality')
    expect(schema()).toHaveProperty('properties.size.description', expect.stringContaining('16:9'))
    expect(schema()).toHaveProperty('properties.prompt.description', expect.stringContaining('1500'))
    const rejected = await call({ prompt: 'A red square', quality: 'high' })
    expect(rejected).toMatchObject({ isError: true, error: { info: { code: 'IMAGE_GENERATION_INVALID_REQUEST' } } })
    expect(requests).toHaveLength(0)
    handler = (_req, res) => { json(res, { base_resp: { status_code: 0 }, data: { image_base64: [PNG.toString('base64')] } }) }
    expect((await call()).isError).toBe(false)
    expect(requests[0]?.body).not.toHaveProperty('quality')
    await configuration.update({ provider: 'openai' })
    expect(schema()).toHaveProperty('properties.quality')
    handler = (_req, res) => { json(res, JSON_IMAGE) }
    expect((await call({ prompt: 'A red square', quality: 'high' })).isError).toBe(false)
    expect(requests[1]?.body).toHaveProperty('quality', 'high')
  })

  it.each([undefined, 'url'] as const)('downloads MiniMax URL images with response format %s', async (responseFormat) => {
    handler = (req, res) => {
      if (req.url === '/image.png') { res.end(PNG); return }
      json(res, { base_resp: { status_code: 0 }, data: { image_urls: [new URL('/image.png', endpoint).href] } })
    }
    await mount({ provider: 'minimax', ...responseFormat === undefined ? {} : { responseFormat } })
    expect((await call()).isError).toBe(false)
    expect(requests[1]).toEqual({ path: '/image.png', authorization: undefined, body: null })
    if (responseFormat === undefined) expect(requests[0]?.body).not.toHaveProperty('response_format')
    else expect(requests[0]?.body).toHaveProperty('response_format', 'url')
  })

  it.each([
    { size: '511x1024' }, { size: '512x2056' }, { size: '513x1024' }, { size: 'arbitrary' },
    { quality: 'high' }, { outputFormat: 'png' as const },
  ])('rejects unsupported MiniMax configuration before registering: %j', async (config) => {
    await ctx.plugin(LocalAttachmentStore, { dshHome: root })
    expect(() => { plugin.apply(ctx, plugin.Config({ provider: 'minimax', ...config })) })
      .toThrow(expect.objectContaining({ code: 'IMAGE_GENERATION_INVALID_CONFIG' }))
    expect(requests).toHaveLength(0)
  })

  it.each([
    { prompt: 'Landscape', size: 'bad-size' },
    { prompt: 'x'.repeat(1501) }, { prompt: 'Ten squares', count: 10 },
  ])('rejects unsupported MiniMax requests before HTTP acquisition: %j', async (args) => {
    await mount({ provider: 'minimax', maxImages: 10 })
    expect(await call(args)).toMatchObject({ isError: true, error: { info: { code: 'IMAGE_GENERATION_INVALID_REQUEST' } } })
    expect(requests).toHaveLength(0)
  })

  it.each([1004, 1008, 2049])('reports MiniMax status %i without storing images or exposing provider text', async (status) => {
    handler = (_req, res) => { json(res, {
      base_resp: { status_code: status, status_msg: 'private-provider-detail fixture-key' },
      data: { image_base64: [PNG.toString('base64')] },
    }) }
    await mount({ provider: 'minimax' })
    const save = vi.spyOn(ctx.attachments, 'saveImages')
    const result = await call()
    expect(result).toMatchObject({ isError: true, error: { info: { code: 'IMAGE_GENERATION_PROVIDER_ERROR' } } })
    expect(JSON.stringify(result)).toContain(`code ${status}`)
    expect(JSON.stringify(result)).not.toContain('private-provider-detail')
    expect(JSON.stringify(result)).not.toContain('fixture-key')
    expect(save).not.toHaveBeenCalled()
    expect(requests).toHaveLength(1)
  })

  it.each([
    {}, { base_resp: null }, { base_resp: 'success' }, { base_resp: {} }, { base_resp: { status_code: '0' } },
    ...[undefined, null, 'image', [], {}, { image_urls: [] }, { image_urls: [null] }].map(data => ({
      base_resp: { status_code: 0 }, ...data === undefined ? {} : { data },
    })),
  ])('contains malformed MiniMax responses before attachment writes: %j', async (body) => {
    handler = (_req, res) => { json(res, body) }
    await mount({ provider: 'minimax' })
    const save = vi.spyOn(ctx.attachments, 'saveImages')
    expect(await call()).toMatchObject({ isError: true, error: { info: { code: 'IMAGE_GENERATION_INVALID_RESPONSE' } } })
    expect(save).not.toHaveBeenCalled()
  })

  it('reports the actual count when a provider returns fewer images', async () => {
    await mount()
    const result = await call({ prompt: 'Two squares', count: 2 })
    expect(result.isError, JSON.stringify(result)).toBe(false)
    const text = result.content[0]
    if (text?.type !== 'text') throw new Error('generation summary missing')
    expect(text.text).toContain('Generated 1 of 2 requested images.')
  })

  it('keeps images usable when attachment storage has no host path', async () => {
    await mount()
    vi.spyOn(ctx.attachments, 'imageHostPath').mockReturnValue(undefined)
    const result = await call()
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(result.content[0]).toMatchObject({ text: `Generated 1 of 1 requested images.\nImage 1: 1x1, image/png, ${PNG.length} bytes.` })
  })

  it('presents the prompt and saved image content without changing the result', async () => {
    await mount()
    const result = await call()
    const tool = ctx.tools.get('generate_image')
    expect(tool?.isConcurrencySafe?.({ prompt: 'A red square' })).toBe(false)
    expect(tool?.presentCall?.({ prompt: 'A red square' })).toEqual({ card: 'generic', title: 'A red square' })
    expect(tool?.presentResult?.({ prompt: 'A red square' }, result)).toEqual({ card: 'generic', content: result.content })
  })

  it('contains image-inspection failures before attachment writes', async () => {
    await mount()
    vi.mocked(fileType.fileTypeFromBuffer).mockRejectedValueOnce(new Error('image inspection failed'))
    const save = vi.spyOn(ctx.attachments, 'saveImages')
    expect(await call()).toMatchObject({ isError: true, error: { info: { code: 'IMAGE_GENERATION_INVALID_RESPONSE' } } })
    expect(save).not.toHaveBeenCalled()
  })

  it.each([
    { prompt: '' }, { prompt: ' ' }, { prompt: 'Square', count: 0 }, { prompt: 'Square', count: 5 },
    { prompt: 'Square', size: '' }, { prompt: 'Square', quality: ' ' },
  ])('rejects unusable model arguments before contacting the provider: %j', async (args) => {
    await mount()
    expect(await call(args)).toMatchObject({ isError: true, error: { info: { code: 'IMAGE_GENERATION_INVALID_REQUEST' } } })
    expect(requests).toHaveLength(0)
  })

  it('enforces attachment count policy before provider acquisition', async () => {
    await mount({}, { maxImagesPerMessage: 1 })
    expect(await call({ prompt: 'Squares', count: 2 })).toMatchObject({ isError: true, error: { info: { code: 'IMAGE_GENERATION_INVALID_REQUEST' } } })
    expect(requests).toHaveLength(0)
  })

  it.each([401, 429, 503])('reports HTTP %i without exposing response bodies or retrying', async (status) => {
    handler = (_req, res) => { json(res, { error: { message: 'secret-provider-details' } }, status) }
    await mount()
    const result = await call()
    expect(result).toMatchObject({ isError: true, error: { info: { code: 'IMAGE_GENERATION_PROVIDER_ERROR' } } })
    expect(JSON.stringify(result)).not.toContain('secret-provider-details')
    expect(JSON.stringify(result)).not.toContain('fixture-key')
    expect(requests).toHaveLength(1)
  })

  it('rejects a credential-bearing redirect before the target receives a request', async () => {
    handler = (_req, res) => { res.writeHead(307, { location: new URL('/redirect-target', endpoint).href }); res.end() }
    await mount()
    expect(await call()).toMatchObject({ isError: true, error: { info: { code: 'IMAGE_GENERATION_PROVIDER_ERROR' } } })
    expect(requests.map(request => request.path)).toEqual(['/images/generations'])
  })

  it.each([
    null, 'image', {}, { data: [] }, { data: [null] }, { data: ['image'] }, { data: [[]] },
    { data: [{ b64_json: '' }] }, { data: [{ b64_json: 'bad!' }] },
    { data: [{ url: 'file:///private/image.png' }] }, { data: [{ url: 'https://user:password@example.test/image' }] },
    { data: [{ b64_json: PNG.toString('base64') }, { b64_json: PNG.toString('base64') }] },
    { data: [{ b64_json: Buffer.from('%PDF-1.7\n').toString('base64') }] },
    { data: [{ b64_json: Buffer.from('plain text').toString('base64') }] },
    { data: [{ b64_json: PNG.subarray(0, 10).toString('base64') }] },
  ])('rejects invalid provider results without attachment writes: %j', async (body) => {
    handler = (_req, res) => { json(res, body) }
    await mount()
    const save = vi.spyOn(ctx.attachments, 'saveImages')
    expect(await call()).toMatchObject({ isError: true, error: { info: { code: 'IMAGE_GENERATION_INVALID_RESPONSE' } } })
    expect(save).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON and empty HTTP responses', async () => {
    await mount()
    handler = (_req, res) => { res.end('{') }
    expect(await call()).toMatchObject({ isError: true, error: { info: { code: 'IMAGE_GENERATION_INVALID_RESPONSE' } } })
    handler = (_req, res) => { res.writeHead(204); res.end() }
    expect(await call()).toMatchObject({ isError: true, error: { info: { code: 'IMAGE_GENERATION_INVALID_RESPONSE' } } })
  })

  it('bounds the complete JSON response before decoding', async () => {
    await mount({ maxResponseBytes: 1 })
    expect(await call()).toMatchObject({ isError: true, error: { info: { code: 'IMAGE_GENERATION_LIMIT_EXCEEDED' } } })
  })

  it.each([10, PNG.length - 1])('bounds base64 images at %i bytes before storage', async (maxImageBytes) => {
    await mount({}, { maxImageBytes })
    expect(await call()).toMatchObject({ isError: true, error: { info: { code: 'IMAGE_GENERATION_LIMIT_EXCEEDED' } } })
  })

  it('bounds the aggregate image batch without saving its first image', async () => {
    handler = (_req, res) => { json(res, { data: [JSON_IMAGE.data[0], JSON_IMAGE.data[0]] }) }
    await mount({}, { maxMessageImageBytes: PNG.length })
    const save = vi.spyOn(ctx.attachments, 'saveImages')
    expect(await call({ prompt: 'Two squares', count: 2 })).toMatchObject({ isError: true, error: { info: { code: 'IMAGE_GENERATION_LIMIT_EXCEEDED' } } })
    expect(save).not.toHaveBeenCalled()
  })

  it('bounds downloaded images independently of JSON response size', async () => {
    handler = (req, res) => {
      if (req.url === '/image.png') { res.end(PNG); return }
      json(res, { data: [{ url: new URL('/image.png', endpoint).href }] })
    }
    await mount({}, { maxImageBytes: 10 })
    expect(await call()).toMatchObject({ isError: true, error: { info: { code: 'IMAGE_GENERATION_LIMIT_EXCEEDED' } } })
  })

  it('reports failed storage after generation without publishing an image result', async () => {
    await mount()
    vi.spyOn(ctx.attachments, 'saveImages').mockRejectedValue(new Error('storage unavailable'))
    const result = await call()
    expect(result).toMatchObject({ isError: true, error: { info: { code: 'IMAGE_GENERATION_STORAGE_FAILED' } } })
    expect(result.content.some(part => part.type === 'image')).toBe(false)
    expect(requests).toHaveLength(1)
  })

  it('cancels an in-flight provider request without retrying or storing images', async () => {
    const started = Promise.withResolvers<undefined>()
    handler = () => { started.resolve(undefined) }
    await mount()
    const controller = new AbortController()
    const result = call({ prompt: 'Square' }, controller.signal)
    await started.promise
    controller.abort(new Error('image generation cancelled'))
    expect((await result).isError).toBe(true)
    expect(requests).toHaveLength(1)
  })

  it('contains a response-stream failure and releases the reader', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('body failed')) } })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(stream))
    await expect(requestBytes(endpoint, {}, 100, new AbortController().signal))
      .rejects.toMatchObject({ code: 'IMAGE_GENERATION_PROVIDER_ERROR' })
    expect(stream.locked).toBe(false)
  })

  it.each([
    { endpoint: 'not a URL' }, { endpoint: 'ftp://example.test/image' }, { endpoint: 'https://user:password@example.test/image' },
    { endpoint: 'https://example.test/image#fragment' }, { apiKey: '' }, { apiKey: 'a\nb' }, { model: ' ' },
    { timeoutMs: 0 }, { maxImages: 1.5 }, { maxErrorsPerTurn: 0 }, { maxErrorsPerTurn: 1.5 }, { maxResponseBytes: 0 }, { size: '' }, { quality: ' ' },
  ])('fails invalid configuration before tool registration: %j', async (config) => {
    await ctx.plugin(LocalAttachmentStore, { dshHome: root })
    expect(() => { plugin.apply(ctx, plugin.Config({ enabled: true, endpoint, apiKey: 'fixture-key', model: 'fixture-model', ...config })) })
      .toThrow(expect.objectContaining({ code: 'IMAGE_GENERATION_INVALID_CONFIG' }))
    expect(ctx.tools.schemas().map(tool => tool.name)).not.toContain('generate_image')
    expect(requests).toHaveLength(0)
  })
})
