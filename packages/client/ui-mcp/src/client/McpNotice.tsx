/** MCP operation feedback hosted outside the page. @module */
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpLocaleKey } from './locales.ts'

/** One completed management operation; contains no transport error body. */
export interface McpNoticeValue { readonly key: McpLocaleKey; readonly seq: number; readonly success: boolean }

/** Persistent notice source and dismissal callback. */
export interface McpNoticeInjected {
  hooks: { notice: SnapshotStore<McpNoticeValue | null> }
  dismiss: () => void
}

/** Framework-provided notice hook and page copy. */
export type McpNoticeProps = InjectFace<McpNoticeInjected> & PropsLocale<'mcpConfigManager'>

/** Render the most recent completed operation after navigation.
 * @param props - notice source and localized text.
 * @returns one toast, or nothing after dismissal.
 */
export function McpNotice({ useNotice, dismiss, t }: McpNoticeProps) {
  const notice = useNotice(value => value)
  return notice === null ? null : <Toast key={notice.seq} text={t(notice.key)}
    {...notice.success ? { tone: 'success' as const } : {}} onDone={dismiss} />
}
