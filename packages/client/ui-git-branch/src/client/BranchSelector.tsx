/** Working-directory context above the composer, with searchable local branches. */

import { useState } from 'react'
import {
  Button, IconBranchOutlineRegular, IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconFolderCloseRegular,
  IconWarningOutlineRegular,
  Menu, MenuItemButton, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime, PropsLocale, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { GitBranchState } from '../types.ts'
import css from './BranchSelector.module.css'

/** Data and commands supplied by the branch plugin. */
export interface BranchInjected {
  /** Switch and report the outcome through the shell-owned toast. */
  checkout: (sessionId: SessionId, branch: string, expected: string) => Promise<void>
  /** The blank-session workspace row already supplies its directory label. */
  compact: boolean
}

/** Framework seats and this plugin's commands. */
export type BranchSelectorProps =
  Pick<PropsRuntime<'conversation.input.dock'>, 'sessionId' | 'useSessions' | 'useResource'>
  & InjectFace<BranchInjected> & PropsLocale<'gitBranch'>

/** Composer extension owner values and the common branch controls. */
export type ComposerBranchSelectorProps = PropsRuntime<'conversation.input.dock'> & BranchSelectorProps

/**
 * Keep the active Session's directory context directly above its composer.
 * @param props - Composer state and branch-control seats.
 * @returns The context row, with blank Sessions using the existing Hero workspace row.
 */
export function ComposerBranchSelector(props: ComposerBranchSelectorProps) {
  return props.session.blank ? null : <BranchSelector {...props} />
}

/**
 * Display the directory's current Git branch and expose existing local branches.
 * @param props - Session resource, activity, locale, and switch command seats.
 * @returns Composer directory and branch controls, or nothing outside a Git working tree.
 */
export function BranchSelector({ sessionId, useSessions, useResource, checkout, compact, t }: BranchSelectorProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [revision, setRevision] = useState(0)
  const [switching, setSwitching] = useState(false)
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const directory = cwd?.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || cwd
  const running = useSessions(s => Object.values(s.byId).some(item => item.cwd === cwd && item.running))
  const resource = useResource<'git-branch'>(`dsh-resource://git-branch/${encodeURIComponent(sessionId)}?revision=${revision}`)
  const state: GitBranchState | undefined = resource.value
  if (state?.kind === 'unavailable' || (resource.status !== 'failed' && state === undefined)) return null
  const repository = state?.kind === 'repository' ? state : undefined
  const label = repository === undefined
    ? t('branch.unavailable')
    : repository.current === null ? t('branch.detached', { commit: repository.commit }) : repository.current
  const tooltip = resource.status === 'failed' ? t('branch.loadFailed')
    : running ? t('branch.busy') : t('branch.switch', { branch: label })
  const filtered = repository?.branches.filter(branch => branch.name.toLowerCase().includes(query.trim().toLowerCase())) ?? []
  const close = (): void => { setOpen(false); setQuery('') }
  const select = (branch: string, selection: Extract<GitBranchState, { kind: 'repository' }>): void => {
    close()
    if (branch === selection.current) return
    setSwitching(true)
    void checkout(sessionId, branch, selection.current === null ? selection.commit : selection.current).finally(() => {
      setSwitching(false)
    })
  }
  return (
    <div className={compact ? css.inline : css.contextRow} data-git-branch-context="">
      {!compact && cwd !== undefined && (
        <Tooltip label={cwd} portal openOnClick>
          <span className={css.directory} tabIndex={0}>
            <IconFolderCloseRegular size={16} />
            <span className={css.directoryName}>{directory}</span>
          </span>
        </Tooltip>
      )}
      <Menu open={open} onClose={close} portal side="top" align="start" className={css.menuAnchor} listClassName={css.menu}
        anchor={(
          <Tooltip label={tooltip} portal>
            <Button size="sm" className={css.trigger} aria-label={t('branch.switch', { branch: label })}
              aria-haspopup="menu" aria-expanded={open} aria-busy={switching} disabled={switching}
              onClick={() => { setOpen(value => !value); setQuery('') }}>
              {resource.status === 'failed' ? <IconWarningOutlineRegular size={14} /> : <IconBranchOutlineRegular size={14} />}
              <span className={css.label}>{label}</span>
              <IconChevronDownOutlineRegular size={12} />
            </Button>
          </Tooltip>
        )}>
        {resource.status === 'failed' && (
          <>
            <p className={css.notice} role="alert">{t('branch.loadFailed')}</p>
            <MenuItemButton onSelect={() => { setRevision(value => value + 1) }}>{t('branch.retry')}</MenuItemButton>
          </>
        )}
        {repository !== undefined && (
          <>
            {(repository.current === null || !repository.branches.some(branch => branch.name === repository.current)) && (
              <p className={css.notice}>{label}</p>
            )}
            <input type="search" className={css.search} placeholder={t('branch.search')} aria-label={t('branch.search')}
              value={query} onChange={(event) => { setQuery(event.target.value) }} />
            <div className={css.branches}>
              {filtered.map(branch => (
                <MenuItemButton key={branch.name} current={branch.name === repository.current}
                  disabled={running || switching || branch.occupied || resource.status === 'failed'}
                  onSelect={() => { select(branch.name, repository) }}>
                  <span className={css.branchRow}>
                    <span className={css.branchText}>
                      <span className={css.branchName}>{branch.name}</span>
                      {branch.occupied && <span className={css.detail}> {t('branch.occupied')}</span>}
                    </span>
                    {branch.name === repository.current && <IconCheckOutlineRegular size={14} />}
                  </span>
                </MenuItemButton>
              ))}
              {filtered.length === 0 && <p className={css.notice}>{t(repository.branches.length === 0 ? 'branch.unborn' : 'branch.empty')}</p>}
            </div>
            <p className={css.notice}>{t(running ? 'branch.busy' : 'branch.shared')}</p>
          </>
        )}
      </Menu>
    </div>
  )
}
