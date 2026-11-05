/** The shell owns transient outcomes so they survive management-page navigation. */

import type { ReactNode } from 'react'
import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { Notice } from './types.ts'

/** Reactive notice source and its single dismissal command. */
export interface NoticeInjected {
  readonly hooks: { readonly notice: ObservableSnapshot<Notice | null> }
  readonly dismiss: () => void
}

/**
 * Render one localized operation outcome independently of the active panel.
 * @param props - Injected outcome and dismissal command.
 * @returns The shared Toast, or no banner while idle.
 */
export function KnowledgeNotice({ useNotice, dismiss }: PropsRuntime<'shell.overlay'> & InjectFace<NoticeInjected>): ReactNode {
  const notice = useNotice(value => value)
  if (notice === null) return null
  return <Toast key={notice.sequence} text={notice.text} onDone={dismiss}
    {...notice.success ? { tone: 'success' as const } : { icon: <IconWarningOutlineRegular size={16} /> }} />
}
