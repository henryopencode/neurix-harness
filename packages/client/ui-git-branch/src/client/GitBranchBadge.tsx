/** Compact repository context beside the conversation's native opening control. */
import { useState } from 'react'
import { IconBranchOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from './provider.ts'
import type {} from './locales.ts'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import css from './GitBranchBadge.module.css'

/**
 * Display the current branch or detached commit; activation reveals the full name.
 * @param props - Session summaries, shared resource reader, and localized copy.
 * @returns a header badge, a retry action after failure, or nothing outside a repository.
 */
export function GitBranchBadge({ sessionId, useSessions, useResource, t }:
  Pick<PropsRuntime<'conversation.session.header.utilities'>, 'sessionId' | 'useSessions' | 'useResource'> & PropsLocale<'git-branch'>) {
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const [retry, setRetry] = useState(0)
  const address = cwd === undefined ? '' : `dsh-resource://git-branch/${encodeURIComponent(sessionId)}?cwd=${encodeURIComponent(cwd)}&retry=${retry}`
  const resource = useResource<'git-branch'>(address)
  if (cwd === undefined || resource.status === 'none' || resource.status === 'loading') return null
  if (resource.status === 'failed') {
    return <Tooltip portal side="bottom" label={t('failed')}>
      <button type="button" className={css.badge} aria-label={t('retry')} onClick={() => { setRetry(value => value + 1) }}>
        <IconBranchOutlineRegular size={14} /><span>{t('retry')}</span>
      </button>
    </Tooltip>
  }
  const head = resource.value
  if (head === undefined) return null
  let name: string
  let label: string
  switch (head.kind) {
    case 'not-repository':
    case 'unavailable': return null
    case 'branch':
      name = head.name
      label = t('branch', { name })
      break
    case 'detached':
      name = label = t('detached', { commit: head.commit })
      break
    default: return assertNever(head)
  }
  return <Tooltip portal side="bottom" openOnClick label={label}>
    <button type="button" className={css.badge} aria-label={label}>
      <IconBranchOutlineRegular size={14} /><span className={css.name}>{name}</span>
    </button>
  </Tooltip>
}
