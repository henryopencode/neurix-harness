/** Profile controls for the official native delegation bundles. */
import { useEffect, type ReactNode } from 'react'
import { Button, PluginArtworkTerminal, StateDot, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { bundleBusy, isInstallPending, type PluginManagerFace } from './manager-store.ts'
import type {} from './harness-tools-locales.ts'
import css from './HarnessToolsSection.module.css'

/** Read and change the same profile selection as the Plugins page. */
export type HarnessToolsFace = Pick<PluginManagerFace, 'ensure' | 'setEnabled'> & {
  readonly hooks: Pick<PluginManagerFace['hooks'], 'pluginManager'>
  /** Retry reading the managed profile. */
  readonly reload: () => void
}

type SectionProps = PropsLocale<'harnessTools'> & InjectFace<HarnessToolsFace>

const tools = [
  { id: 'codex', name: 'Codex', bundle: '@deepseek-ai/dsh-subagent-codex' },
  { id: 'claude-code', name: 'Claude Code', bundle: '@deepseek-ai/dsh-subagent-claude-code' },
] as const

/**
 * Control Agent access to Codex and Claude Code independently of the open Chat.
 * @param props - the localized copy and shared profile controls.
 * @returns the Harness tools settings section.
 */
export function HarnessToolsSection({ t, usePluginManager, ensure, reload, setEnabled }: SectionProps): ReactNode {
  const state = usePluginManager(snapshot => snapshot)
  useEffect(ensure, [ensure])
  const loading = state.status === 'idle' || state.status === 'loading'
  const installing = state.install.phase === 'checking' || isInstallPending(state.install.phase)

  return <section className={css.section} data-harness-tools aria-label={t('title')}>
    <h2 className={css.title}>{t('title')}</h2>
    {state.status === 'error' && <div className={css.retry}>
      <p className={css.note} role="alert">{t('loadFailed')}</p>
      <Button variant="outline" size="sm" onClick={reload}>{t('retry')}</Button>
    </div>}
    {state.status === 'unavailable'
      ? <p className={css.note} role="status">{t('unavailable')}</p>
      : <ul className={css.list} aria-busy={loading}>
        {tools.map(({ id, name, bundle }) => {
          const pkg = state.packages.find(candidate => candidate.name === bundle && candidate.official)
          const enabled = pkg?.enabled === true
          const pending = bundleBusy(state, bundle)
            || pkg?.rows.some(row => row.entryId !== undefined && state.busy.includes(row.entryId)) === true
          const waitingForInstaller = installing && pkg?.availability === 'missing' && !enabled
          const provider = pkg?.rows.find(row => row.rowId === `subagent-${id}`)
          const tool = pkg?.rows.find(row => row.rowId === `tool-subagent-${id}`)
          const active = provider?.phase === 'active' && tool?.phase === 'active'
          const blocked = pkg === undefined || pkg.readOnlyReason !== undefined || (!enabled && pkg.error !== undefined)
          let issue: string | undefined
          if (state.status === 'ready' && !pending) {
            if (pkg?.error?.code === 'unsupported-platform') issue = t('unsupported')
            else if (blocked) issue = t('unavailable')
            else if (enabled && !active) issue = t('notActive')
            else if (!enabled && active) issue = t('stillActive')
          }
          return <li key={id} className={css.row}>
            <div className={css.control}>
              <h3 className={css.name}>{name}</h3>
              <div className={css.actions}>
                <span role="status" className={css.progress}>
                  {pending && <><span className={css.visuallyHidden}>{t('changing', { tool: name })}</span><StateDot state="ongoing" /></>}
                </span>
                <Switch checked={enabled} label={t('toggle', { tool: name })}
                  disabled={state.status !== 'ready' || pending || blocked || waitingForInstaller}
                  onChange={(next) => { setEnabled(bundle, next) }} />
              </div>
            </div>
            {issue !== undefined && <p className={css.note} role="status">{issue}</p>}
          </li>
        })}
      </ul>}
  </section>
}

/**
 * Render the terminal glyph for the Harness tools settings entry.
 * @param props - settings navigation icon dimensions.
 * @returns the glyph.
 */
export function HarnessToolsIcon({ size }: PropsRuntime<'settings.section.icon'>): ReactNode {
  return <PluginArtworkTerminal size={size} />
}
