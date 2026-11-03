/** Shell-owned feedback survives closure of the phone plugin page. @module */
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConnectionNotice } from './notice.ts'

/** Connection notice source and its dismissal action. */
export interface ConnectionToastInjected {
  hooks: { connectionNotice: ConnectionNotice['source'] }
  dismiss: () => void
}

/** Framework notice hook and localized copy. */
export type ConnectionToastProps = InjectFace<ConnectionToastInjected> & PropsLocale<'settings.mobileAccess'>

/**
 * Render the latest connection-operation outcome outside the plugin page.
 * @param props - framework-bound notice source and dismissal callback.
 * @returns a transient notice, or nothing when no action has completed.
 */
export function ConnectionToast({ useConnectionNotice, dismiss, t }: ConnectionToastProps) {
  const notice = useConnectionNotice(value => value)
  return notice === null ? null : <Toast key={notice.seq} text={t(notice.outcome)}
    {...notice.outcome === 'failed' ? {} : { tone: 'success' as const }} onDone={dismiss} />
}
