/** Generated images remain visible beside their tool row, including after Session replay. @module */

import type { Context } from '@deepseek-ai/cordis'
import { useCallback } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { CONVERSATION_NS as NS } from '../../locale.ts'
import { imageGenerationCardModel } from '../models/image-generation-card-model.ts'
import { GenericToolCard, type GenericToolCardProps } from './GenericToolCard.tsx'
import { toolFileInject, type ToolFileInjected } from '../file-menu.ts'

/** Framework-derived row and child-gallery props. */
export type ImageGenerationRowProps = ToolCallViewProps & ToolFileInjected & PropsRenderSlots<'tool.call.generatedImages'> & Pick<GenericToolCardProps, 't'>

/**
 * Render status and an immediately visible gallery from a complete successful result.
 * @param props - tool lifecycle item, authorized image loader, child slots, and locale.
 * @returns the shared row with a generated-image preview when its content is valid.
 */
export function ImageGenerationRow(props: ImageGenerationRowProps) {
  const { getTriggerProps } = props.useContextMenu()
  const { sessionId, resolveFilePath } = props
  const getFileTriggerProps = useCallback((path: string) => getTriggerProps(() => ({
    kind: 'file', value: { sessionId, path: resolveFilePath(path) },
  })), [getTriggerProps, sessionId, resolveFilePath])
  const image = imageGenerationCardModel(props.block)
  return <>
    <GenericToolCard {...props} resultText={image?.text} getFileTriggerProps={getFileTriggerProps} />
    {image !== null && props.renderSlot('tool.call.generatedImages', {
      images: image.images, align: 'start', loadImage: props.loadImage,
    })}
  </>
}

/** Register the generated-image row through the existing Tool and attachment slots. */
export const imageGenerationToolview = {
  name: 'image-generation-toolview',
  inject: ['slots', 'sessions'],
  /**
   * @param ctx - registering fiber; registrations unwind when it is disposed.
   */
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
      name: 'tool.call.toolview', key: 'generate_image', locale: NS,
      inject: toolFileInject(ctx),
      children: { 'tool.call.generatedImages': { kind: 'single', scope: 'session' } },
    }, ImageGenerationRow))
  },
}
