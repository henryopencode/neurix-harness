/** Frame-wide bookmark feedback retained when the originating Chat panel closes. */
import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TurnBookmarkNoticeHostProps } from '../contract/slots.ts'

/**
 * @param props - bookmark outcome, dismissal callback, and localized copy.
 * @returns the current notification, or null when none is pending.
 */
export function TurnBookmarkNoticeHost({ useNotice, dismissNotice, t }: TurnBookmarkNoticeHostProps) {
  const notice = useNotice(value => value)
  if (notice === null) return null
  const success = notice.kind === 'saved' || notice.kind === 'removed'
  return (
    <Toast
      key={notice.seq}
      text={t(`chat.turnNavigation.bookmark.${notice.kind}`)}
      {...success ? { tone: 'success' as const } : { icon: <IconWarningOutlineRegular size={18} /> }}
      onDone={dismissNotice}
    />
  )
}
