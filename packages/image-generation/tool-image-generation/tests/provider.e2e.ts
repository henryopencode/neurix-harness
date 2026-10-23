/** Opt-in paid Images API smoke; no automatic retry after a generation request. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as plugin from '../src/index.ts'
import type { ImageGenerationProvider } from '../src/index.ts'

const apiKey = process.env.DSH_IMAGE_API_KEY
const model = process.env.DSH_IMAGE_MODEL
const provider: ImageGenerationProvider = process.env.DSH_IMAGE_PROVIDER === 'minimax' ? 'minimax' : 'openai'

it.skipIf(!apiKey || !model)('generates and saves one image from a configured real provider', {
  timeout: 240_000,
  retry: 0,
}, async () => {
  if (apiKey === undefined || model === undefined) throw new Error('image provider credentials were not supplied')
  const root = await mkdtemp(join(tmpdir(), 'dsh-image-generation-e2e-'))
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalAttachmentStore, { dshHome: root })
    await ctx.plugin(plugin, {
      apiKey, model, provider, enabled: true,
      ...process.env.DSH_IMAGE_ENDPOINT === undefined ? {} : { endpoint: process.env.DSH_IMAGE_ENDPOINT },
      ...process.env.DSH_IMAGE_SIZE === undefined ? {} : { size: process.env.DSH_IMAGE_SIZE },
      ...process.env.DSH_IMAGE_QUALITY === undefined ? {} : { quality: process.env.DSH_IMAGE_QUALITY },
    }).await()
    const result = await ctx.tools.execute({
      name: 'generate_image', callId: ToolCallId('real-image-call'),
      arguments: { prompt: 'A simple red square centered on a plain white background.' },
      signal: AbortSignal.timeout(180_000),
    })
    expect(result.isError, JSON.stringify(result)).toBe(false)
    const image = result.content.find(part => part.type === 'image')
    if (image?.type !== 'image') throw new Error('provider returned no durable image')
    expect(image.attachment.width).toBeGreaterThan(0)
    expect(image.attachment.height).toBeGreaterThan(0)
    const path = ctx.attachments.imageHostPath(image.attachment)
    if (path === undefined) throw new Error('local image path missing')
    expect((await readFile(path)).length).toBe(image.attachment.bytes)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
