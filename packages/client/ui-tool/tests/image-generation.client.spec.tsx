// @vitest-environment jsdom
/** Generated-image previews use the shared authorized gallery and preserve malformed-result fallback. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh, en } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import type { StartedToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { useDisclosure } from '@deepseek-ai/dsh-client-ui-chat/src/client/chat/use-disclosure.ts'
import { imageGenerationCardModel } from '../src/client/tool/models/image-generation-card-model.ts'
import { ImageGenerationRow, imageGenerationToolview } from '../src/client/tool/toolviews/image-generation-row.tsx'
import type { ImageGenerationRowProps } from '../src/client/tool/toolviews/image-generation-row.tsx'
import type { ToolImagesOwnerProps } from '../src/client/contract/slots.ts'
import { readImageToolview } from '../src/client/tool/toolviews/read-image-row.tsx'

afterEach(cleanup)

const argsRaw = '{"prompt":"A red square"}'
const image: ImageAttachmentRef = {
  attachmentId: AttachmentId('provider-image'), mediaType: 'image/png', bytes: 69, width: 1, height: 1, name: 'generated-1.png',
}
const pending: StartedToolCall = {
  phase: 'start', callId: 'image-call', name: 'generate_image', argsRaw, args: PartialArguments.fromText(argsRaw),
  turn: 1, step: 1, time: 1, subCalls: [],
}
function result(over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result', seq: 1, time: 2, callId: 'image-call', name: 'generate_image',
    args: PartialArguments.fromText(argsRaw), call: { name: 'generate_image', argsRaw }, callTime: 1,
    content: [{ type: 'text', text: 'Generated 1 of 1 requested images.' }, { type: 'image', attachment: image }],
    isError: false, meta: undefined, subCalls: [], ...over,
  }
}

function props(block: StartedToolCall | ToolResultNode): ImageGenerationRowProps {
  const stage = 'kind' in block ? { phase: 'result' as const, block } : { phase: 'start' as const, block }
  return {
    ...stage, callId: 'image-call', toolName: 'generate_image',
    useDisclosure, openFile: vi.fn(), loadImage: vi.fn(),
    t: makeTranslate(zh, commonZh),
    renderSlot: (_name: 'tool.call.generatedImages', owner: ToolImagesOwnerProps) => <div aria-label="generated images">
      {owner.images.map((source, index) => 'attachment' in source
        ? <img key={index} alt={source.attachment.name} data-image-id={source.attachment.attachmentId} />
        : null)}
    </div>,
  } as ImageGenerationRowProps
}

describe('generated image previews', () => {
  it('shows generated images while their inspection row stays collapsed', () => {
    const view = render(<ImageGenerationRow {...props(result())} />)
    expect(view.getByText('生成图片')).toBeTruthy()
    expect(view.getByAltText('generated-1.png')).toBeTruthy()
    expect(view.queryByText('Generated 1 of 1 requested images.')).toBeNull()
    fireEvent.click(view.getByText('生成图片'))
    expect(view.getByText('Generated 1 of 1 requested images.')).toBeTruthy()
    expect(view.container.textContent).not.toContain('provider-image')
    expect(makeTranslate(en, commonZh)('tool.title.generateImage')).toBe('Generate image')
  })

  it('preserves pending and failed row details without showing a gallery', () => {
    const view = render(<ImageGenerationRow {...props(pending)} />)
    expect(view.queryByLabelText('generated images')).toBeNull()
    view.rerender(<ImageGenerationRow {...props(result({ isError: true, content: [{ type: 'text', text: 'Check image-generation credentials.' }] }))} />)
    expect(view.queryByLabelText('generated images')).toBeNull()
    expect(view.getByText('Check image-generation credentials.')).toBeTruthy()
  })

  it('derives previews from the result content and keeps additional text', () => {
    expect(imageGenerationCardModel(result({ content: [
      { type: 'text', text: 'Generated.' }, { type: 'image', attachment: image }, { type: 'text', text: 'Partial batch.' },
    ] }))).toEqual({ label: 'A red square', images: [{ attachment: image }], text: 'Generated.\nPartial batch.' })
  })

  it.each([
    pending,
    result({ isError: true }),
    result({ call: null }),
    result({ call: { name: 'other_tool', argsRaw } }),
    result({ call: { name: 'generate_image', argsRaw: '{}' } }),
    result({ call: { name: 'generate_image', argsRaw: '{"prompt":" "}' } }),
    result({ content: [] }),
    result({ content: [{ type: 'reasoning', text: 'unsupported extra block' }, { type: 'image', attachment: image }] }),
    result({ content: [{ type: 'image', attachment: { ...image, bytes: 0 } }] }),
  ])('keeps the generic fallback for an unsupported lifecycle/result: %j', (block) => {
    expect(imageGenerationCardModel(block)).toBeNull()
  })

  it('coexists with read_image and releases its independent gallery on disposal', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SlotRegistry).await()
      ctx.slots.register({ name: 'root', children: {
        'tool.call.toolview': { kind: 'keyed', scope: 'session' },
      } } as never, () => null)
      await ctx.plugin(readImageToolview).await()
      const generation = await ctx.plugin(imageGenerationToolview).await()
      const entries = ctx.slots.entries('tool.call.toolview')
      expect(entries.map(entry => entry.options.key)).toEqual(['read_image', 'generate_image'])
      expect(entries[1]?.children).toEqual({ 'tool.call.generatedImages': { kind: 'single', scope: 'session' } })
      await generation.dispose()
      expect(ctx.slots.entries('tool.call.toolview').map(entry => entry.options.key)).toEqual(['read_image'])
    } finally { await ctx.fiber.dispose() }
  })
})
