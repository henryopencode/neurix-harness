/** Derive generated-image previews from the result's durable image blocks. @module */

import type { ToolCallBlock } from './tool-call-model.ts'
import { fullyRendered, imageReferences, type ImageCardModel } from './image-card-model.ts'
import { parsedToolCall } from './raw-tool-call.ts'

/**
 * Validate a successful generated-image result without deriving attachment URLs or reading host state.
 * @param block - live or replayed tool lifecycle item.
 * @returns complete image-gallery material, or null for the generic row.
 */
export function imageGenerationCardModel(block: ToolCallBlock): ImageCardModel | null {
  if (!('kind' in block) || block.isError) return null
  const call = parsedToolCall(block)
  if (call?.name !== 'generate_image' || typeof call.args.prompt !== 'string' || call.args.prompt.trim() === '') return null
  if (!fullyRendered(block.content)) return null
  const refs = imageReferences(block.content)
  if (refs === null) return null
  return {
    label: call.args.prompt,
    images: refs.map(attachment => ({ attachment })),
    text: block.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n'),
  }
}
