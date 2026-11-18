/** Optional action for recorded failures, not synthetic Chat placeholders. */
import { useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { diagnosticToolFailure } from '../classify.ts'
import type { DiagnosticFocus } from '../types.ts'

/** Capability supplied only while the existing settings shell is available. */
export interface DiagnosticShortcutInjected {
  /** Open the source record in the existing diagnostics section. */
  openDiagnostic: (focus: DiagnosticFocus) => void
}

/** Settled-card extension props; arguments and full transcripts are never copied. */
export type DiagnosticShortcutProps = PropsRuntime<'tool.call.action'> & PropsLocale<'sessionDiagnostics'> & InjectFace<DiagnosticShortcutInjected>

/**
 * Offer diagnostics for recorded failures, including nonzero commands with isError=false.
 * @param props - Settled record, source Session and shell-owned navigation capability.
 * @returns Optional action or a visible localized navigation failure.
 */
export function DiagnosticShortcut({ block, sessionId, t, openDiagnostic }: DiagnosticShortcutProps): ReactNode {
  const [failed, setFailed] = useState(false)
  if (!Number.isSafeInteger(block.seq) || block.seq < 0 || diagnosticToolFailure(block) === undefined) return null
  return <span>
    <Button variant="ghost" onClick={() => {
      try { openDiagnostic({ sessionId, eventSeq: block.seq as DiagnosticFocus['eventSeq'] }); setFailed(false) }
      catch (_error) { setFailed(true) }
    }}>{t('shortcut')}</Button>
    {failed ? <span role="alert">{t('unavailable')}</span> : null}
  </span>
}
