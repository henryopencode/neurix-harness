/** Display the Agent's browser target beside the conversation. @module */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { browserCaptureAddress } from './browser-capture-address.ts'
import css from './ComputerPreview.module.css'

/** Wakes this Session's shared capture rather than starting another request. */
export interface BrowserRetry {
  /** @param id - Session whose capture should retry. */
  retry: (id: SessionId) => void
}

type Props = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'computerPreview'> & InjectFace<BrowserRetry>

/**
 * @param props - Session-scoped resource and localized preview labels.
 * @returns the same captured page drawn in picture-in-picture.
 */
export function BrowserViewport({ sessionId, useResource, retry, t }: Props) {
  const { status, value } = useResource<'agent-browser'>(browserCaptureAddress(sessionId))
  const frame = value?.frame
  const failed = status === 'failed' || frame?.kind === 'unavailable' || frame?.kind === 'idle'
  return <div className={css.browserViewport} data-agent-browser-viewport>
    {frame?.kind === 'frame' ? <img src={frame.imageUrl} alt={t('previewImage')} draggable={false} /> : null}
    {failed ? <div className={css.browserStatus} role="status">
      <span>{t('previewUnavailable')}</span>
      <button className={css.retry} type="button" onClick={() => { retry(sessionId) }}>{t('previewRetry')}</button>
    </div> : null}
  </div>
}
