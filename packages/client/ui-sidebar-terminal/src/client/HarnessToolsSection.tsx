/** Settings for discovering and starting interactive Harness tools. */
import { useEffect, useState, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TerminalProgramLaunch, TerminalProgramStatus } from '@deepseek-ai/dsh-api-terminal-controller/types'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, PluginArtworkTerminal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './harness-tools-locales.ts'
import css from './HarnessToolsSection.module.css'

/** Current terminal Session and Host operations owned by the plugin. */
export interface HarnessToolsInjected {
  readonly hooks: { readonly terminalSession: HostObservable<SessionId | undefined> }
  /** @param session - current Session, if any. @param signal - query lifetime. @returns configured program status. */
  readonly load: (session: SessionId | undefined, signal: AbortSignal) => Promise<readonly TerminalProgramStatus[]>
  /** @param session - observed Session. @param program - chosen launch action. @returns whether the terminal tab opened. */
  readonly launch: (session: SessionId, program: TerminalProgramLaunch) => boolean
}

type SectionProps = PropsRuntime<'settings.section'> & PropsLocale<'harnessTools'> & InjectFace<HarnessToolsInjected>
type PanelProps = Pick<SectionProps, 't' | 'load' | 'launch' | 'close'> & { readonly session: SessionId | undefined }

interface ProgramsState {
  readonly phase: 'checking' | 'ready' | 'failed'
  readonly programs?: readonly TerminalProgramStatus[] | undefined
}

/**
 * Tie displayed detections to the execution environment currently on screen.
 * @param props - settings controls and the injected terminal observation.
 * @returns the corresponding program settings panel.
 */
export function HarnessToolsSection({ useTerminalSession, ...props }: SectionProps): ReactNode {
  const session = useTerminalSession(current => current)
  return <HarnessToolsPanel key={session ?? 'host'} session={session} {...props} />
}

/**
 * Identify the settings section with the terminal glyph already used for interactive terminals.
 * @param props - settings navigation icon dimensions.
 * @returns the glyph.
 */
export function HarnessToolsIcon({ size }: PropsRuntime<'settings.section.icon'>): ReactNode {
  return <PluginArtworkTerminal size={size} />
}

function HarnessToolsPanel({ session, t, load, launch, close }: PanelProps): ReactNode {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ProgramsState>({ phase: 'checking' })
  useEffect(() => {
    const lifetime = new AbortController()
    void load(session, lifetime.signal).then((programs) => {
      if (!lifetime.signal.aborted) setState({ phase: 'ready', programs })
    }, () => {
      if (!lifetime.signal.aborted) setState(previous => ({ ...previous, phase: 'failed' }))
    })
    return () => { lifetime.abort() }
  }, [attempt, load, session])

  const open = (program: TerminalProgramLaunch): void => {
    if (session !== undefined && launch(session, program)) close()
  }

  return <section className={css.section} data-harness-tools aria-label={t('title')}>
    <header className={css.header}>
      <h2 className={css.title}>{t('title')}</h2>
      <Button variant="outline" size="sm" disabled={state.phase === 'checking'} onClick={() => {
        setState(previous => ({ ...previous, phase: 'checking' }))
        setAttempt(previous => previous + 1)
      }}>{t('refresh')}</Button>
    </header>
    {state.phase === 'checking' && state.programs === undefined && <p className={css.note} role="status">{t('checking')}</p>}
    {state.phase === 'failed' && <p className={css.note} role="alert">{t('checkFailed')}</p>}
    {state.phase === 'ready' && state.programs?.length === 0 && <p className={css.note}>{t('empty')}</p>}
    {session === undefined && state.programs?.some(program => program.installed) === true && <p className={css.note}>{t('chooseSession')}</p>}
    {state.programs !== undefined && state.programs.length > 0 && <ul className={css.list} aria-busy={state.phase === 'checking'}>
      {state.programs.map(program => <li className={css.row} key={program.id}>
        <div className={css.identity}>
          <h3 className={css.name}>{program.name}</h3>
          <Tag className={css.status} tone={program.installed ? 'success' : 'neutral'}>{t(program.installed ? 'installed' : 'notDetected')}</Tag>
        </div>
        <div className={css.actions}>
          {program.installed
            ? <>
              <Button variant="outline" size="sm" aria-label={t('startTool', { tool: program.name })}
                disabled={session === undefined || state.phase !== 'ready'} onClick={() => { open({ id: program.id, mode: 'start' }) }}>{t('start')}</Button>
              {program.canResume && <Button size="sm" aria-label={t('resumeTool', { tool: program.name })}
                disabled={session === undefined || state.phase !== 'ready'} onClick={() => { open({ id: program.id, mode: 'resume' }) }}>{t('resume')}</Button>}
            </>
            : program.guideUrl !== undefined && <a href={program.guideUrl} target="_blank" rel="noopener noreferrer"
              aria-label={t('installTool', { tool: program.name })}>{t('install')}</a>}
        </div>
      </li>)}
    </ul>}
  </section>
}
