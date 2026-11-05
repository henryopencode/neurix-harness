/** Existing bookmark artwork for the knowledge navigation entry. */

import type { ReactNode } from 'react'
import { IconBookmarkOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Render the existing library icon at the sidebar's requested size.
 * @param props - Geometry owned by the sidebar.
 * @returns The knowledge navigation glyph.
 */
export function KnowledgeIcon({ size }: { size: number }): ReactNode {
  return <IconBookmarkOutlineRegular size={size} />
}
