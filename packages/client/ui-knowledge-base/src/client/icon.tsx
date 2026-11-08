/** Open-book navigation artwork for the knowledge document collection. */

import type { ReactNode } from 'react'
import { IconBookOpenOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Render the shared open-book icon at the sidebar's requested size.
 * @param props - Geometry owned by the sidebar.
 * @returns The knowledge navigation glyph.
 */
export function KnowledgeIcon({ size }: { size: number }): ReactNode {
  return <IconBookOpenOutlineRegular size={size} />
}
