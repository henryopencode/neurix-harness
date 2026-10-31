/** Optional Electron status presentation; the native shell owns actions and Web owns visible copy. */
import { IconDownloadOutlineRegular, IconLoadingOutlineRegular, IconRefreshOutlineRegular, IconStopFillRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DesktopUpdateIndicator.module.css'
import type { DesktopUpdateFailureKind, DesktopUpdatePresentation, DesktopUpdateView } from '../types.ts'
import type { SettingsRootInjected } from './shell-contract.ts'

type SettingsTranslate = PropsLocale<'settings'>['t']

const BUSY_PHASES: ReadonlySet<DesktopUpdatePresentation['phase']> = new Set([
  'checking', 'downloading', 'verifying', 'installing',
])

function updateCopy(state: DesktopUpdatePresentation, t: SettingsTranslate): { label: string; detail: string } {
  const labels: Readonly<Record<DesktopUpdatePresentation['phase'], string>> = {
    idle: '',
    checking: t('desktop.update.checking'),
    available: t('desktop.update.download'),
    downloading: t('desktop.update.progress', { percent: state.percent ?? 0 }),
    verifying: t('desktop.update.verifying'),
    installing: t('desktop.update.installing'),
    ready: t(state.installMode === 'installer' ? 'desktop.update.openInstaller' : 'desktop.update.ready'),
    error: t('desktop.update.retry'),
  }
  const label = labels[state.phase]
  if (state.phase === 'ready' && state.installMode === 'installer') {
    return { label, detail: t('desktop.update.installerDetail', { version: state.version ?? '' }) }
  }
  if (state.phase === 'checking' || state.phase === 'verifying' || state.phase === 'installing') {
    return { label, detail: state.version ?? label }
  }
  if (state.phase === 'error') {
    const failures: Readonly<Record<DesktopUpdateFailureKind, string>> = {
      check: t('desktop.update.checkFailed'),
      'check-network': t('desktop.update.checkNetworkFailed'),
      download: t('desktop.update.downloadFailed'),
      'download-network': t('desktop.update.downloadNetworkFailed'),
      install: t('desktop.update.installFailed'),
      'install-network': t('desktop.update.installNetworkFailed'),
      'stop-failed': t('desktop.update.stopFailed'),
      'tasks-changed': t('desktop.update.tasksChanged'),
      'tasks-unavailable': t('desktop.update.tasksUnavailable'),
      'fullscreen-timeout': t('desktop.update.fullscreenTimeout'),
    }
    return { label, detail: failures[state.failure ?? 'install'] }
  }
  if (state.phase === 'downloading' && state.version !== undefined) {
    return { label, detail: t('desktop.update.downloadDetail', { percent: state.percent ?? 0, version: state.version }) }
  }
  return { label, detail: state.version === undefined
    ? label
    : t('desktop.update.versionDetail', { label, version: state.version }) }
}

/**
 * Render a rail action with determinate transfer progress and an explicit stop action.
 * @param props - Localized carrier state and shell-owned actions; wide is retained for existing callers.
 * @returns An icon button above Settings, or nothing without a reported update.
 */
export function DesktopUpdateIndicator({ hidden, t, view, onOpen, onStop }: {
  wide: boolean
  hidden: boolean
  t: SettingsTranslate
  view: DesktopUpdateView
  onOpen: () => void
  onStop?: () => void
}) {
  const { presentation: state, failed, opening } = view
  if (hidden || (!failed && (state === undefined || state.phase === 'idle'))) return null
  const retryLabel = t('desktop.update.retry')
  const copy = state === undefined ? { label: retryLabel, detail: retryLabel } : updateCopy(state, t)
  const canStop = state?.phase === 'downloading' && state.canCancel === true && onStop !== undefined
  const label = canStop ? t('desktop.update.stop') : failed ? retryLabel : copy.label
  const error = failed || state?.phase === 'error'
  const busy = !canStop && (opening || (state !== undefined && BUSY_PHASES.has(state.phase)))
  const percent = Math.min(100, Math.max(0, state?.percent ?? 0))
  return <Tooltip label={canStop ? `${failed ? t('desktop.update.cancelFailed') : copy.detail}\n${label}` : failed ? retryLabel : copy.detail} side="right">
    <button type="button" className={css.indicator}
      aria-label={label} aria-disabled={busy} onClick={() => { if (!busy) { if (canStop) onStop(); else onOpen() } }}>
      {state?.phase === 'downloading' && <svg className={css.progress} viewBox="0 0 36 36"
        role="progressbar" aria-label={t('desktop.update.progress', { percent })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <circle className={css.track} cx="18" cy="18" r="15" />
        <circle cx="18" cy="18" r="15" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - percent} />
      </svg>}
      <span className={css.icon} aria-hidden="true">
        {canStop ? <IconStopFillRegular size={14} />
          : error ? <IconRefreshOutlineRegular size={18} />
            : busy ? <IconLoadingOutlineRegular className={css.spinner} size={18} />
              : state?.phase === 'ready' && state.installMode !== 'installer' ? <IconRefreshOutlineRegular size={18} />
                : <IconDownloadOutlineRegular size={18} />}
      </span>
    </button>
  </Tooltip>
}

type FooterInjected = {
  open: () => void
  stop: () => void
  hooks: { desktopUpdate: HostObservable<DesktopUpdateView> }
}

/**
 * @param props - Framework-bound update source and main-process actions.
 * @returns The same persistent update control in expanded and collapsed sidebars.
 */
export function DesktopUpdateFooter({ useDesktopUpdate, open, stop, t }: PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'settings'> & InjectFace<FooterInjected>) {
  const view = useDesktopUpdate(value => value)
  return <DesktopUpdateIndicator wide={false} hidden={false} t={t} view={view} onOpen={open} onStop={stop} />
}

type BadgeProps = PropsRuntime<'sidebar.toggle.badge'> & PropsLocale<'settings'>
  & Pick<InjectFace<SettingsRootInjected>, 'useDesktopUpdate' | 'useConnectionState'>

/**
 * @param props - Framework-bound carrier and connection state.
 * @returns A non-interactive brand-blue notification on the sidebar expand button.
 */
export function DesktopUpdateBadge({ useDesktopUpdate, useConnectionState, t }: BadgeProps) {
  const { presentation: state, failed } = useDesktopUpdate(value => value)
  const connection = useConnectionState(value => value)
  if (((connection === 'disconnected' || connection === 'connecting') && state?.phase !== 'installing')
    || (!failed && (state === undefined || state.phase === 'idle'))) return null
  const retryLabel = t('desktop.update.retry')
  const copy = state === undefined ? { label: retryLabel, detail: retryLabel } : updateCopy(state, t)
  const label = failed ? retryLabel : copy.label
  return <Tooltip label={failed ? label : copy.detail} side="right">
    <span role="img" aria-label={label} className={css.badge} />
  </Tooltip>
}
