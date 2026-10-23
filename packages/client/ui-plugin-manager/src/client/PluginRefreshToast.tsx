/** Plugin operation feedback hosted outside the requesting page's lifetime. */
import type { ReactNode } from 'react'
import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginManagerFace } from './manager-store.ts'
import { noticeText } from './presentation.ts'

/** The controller's shared notice source and dismissal action. */
export type PluginRefreshToastFace = Pick<PluginManagerFace, 'dismissNotice'> & {
  hooks: Pick<PluginManagerFace['hooks'], 'pluginManager'>
}

/** Render inputs bound from the shared controller and plugin dictionary. */
export type PluginRefreshToastProps = InjectFace<PluginRefreshToastFace> & PropsLocale<'pluginManager'>

/**
 * Display plugin operation outcomes even after navigation leaves the requesting page.
 * @param props - shared notice hook, dismissal action, and locale seat.
 * @returns the current operation toast, or null when no notice is pending.
 */
export function PluginRefreshToast({ usePluginManager, dismissNotice, t }: PluginRefreshToastProps): ReactNode {
  const notice = usePluginManager(state => state.notice)
  if (notice === null) return null
  const text = noticeText(notice, t)
  return (
    <Toast
      key={notice.seq}
      text={text}
      holdMs={Math.min(8_000, Math.max(3_000, text.length * 80))}
      icon={<IconWarningOutlineRegular />}
      onDone={dismissNotice}
    />
  )
}
