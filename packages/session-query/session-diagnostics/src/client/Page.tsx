/** Primary local diagnostics flow inside the existing settings shell. */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, Input, Modal, Select } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DiagnosticCategory, DiagnosticFocus, DiagnosticGroup, DiagnosticGroupId, DiagnosticQuery } from '../types.ts'
import { diagnosticReport, downloadDiagnosticReport, type DiagnosticReport } from './report.ts'
import css from './Diagnostics.module.css'

/** Imperative source navigation; Session data and resources stay framework-owned. */
export interface DiagnosticsInjected {
  openSession: (id: SessionId) => void
  /** Release only the shortcut request consumed by this page opening. */
  releaseFocus: (source: DiagnosticFocus | undefined) => void
  hooks: { focus: HostObservable<DiagnosticFocus | undefined> }
}
/** Complete settings page props assembled by the renderer. */
export type DiagnosticsProps = PropsRuntime<'settings.section'> & PropsLocale<'sessionDiagnostics'> & InjectFace<DiagnosticsInjected>
const categories: DiagnosticCategory[] = ['arguments', 'command', 'permission', 'tool', 'turn']

/**
 * Present explicit index coverage, failure groups, source references and a frozen export preview.
 * @param props - Localized copy, framework hooks and source navigation.
 * @returns Responsive settings content without a secondary data cache or hidden history reads.
 */
export function DiagnosticsPage({
  t, useResource, useWorkspaces, useSessions, useFocus, openSession, releaseFocus, close,
}: DiagnosticsProps): ReactNode {
  const workspaces = useWorkspaces(value => value.items)
  const currentCwd = useSessions(value => Object.values(value.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.cwd)
  const pendingFocus = useFocus(value => value)
  const [focus] = useState(pendingFocus)
  useEffect(() => () => { releaseFocus(focus) }, [focus, releaseFocus])
  const [chosenScope, setScope] = useState<string | undefined>(focus === undefined ? undefined : '@session')
  const scope = chosenScope ?? currentCwd ?? ''
  const [category, setCategory] = useState<DiagnosticCategory | ''>('')
  const [period, setPeriod] = useState('0')
  const [since, setSince] = useState<number | undefined>()
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  const [mode, setMode] = useState<'list' | 'refresh'>('list')
  const [selected, setSelected] = useState<ReadonlySet<DiagnosticGroupId>>(new Set())
  const [detail, setDetail] = useState<DiagnosticGroupId | null | undefined>()
  const [preview, setPreview] = useState<DiagnosticReport | null>(null)
  const [notice, setNotice] = useState('')
  const query: DiagnosticQuery = { scope: scope === '@session' && focus !== undefined ? { kind: 'session', sessionId: focus.sessionId } : scope === '' ? { kind: 'all' } : { kind: 'cwd', cwd: scope },
    ...(category === '' ? {} : { category }), ...(since === undefined ? {} : { since }), ...(search === '' ? {} : { search }),
  }
  const address = `dsh-resource://session-diagnostics/view?query=${encodeURIComponent(JSON.stringify(query))}&mode=${mode}&revision=${revision}`
  const resource = useResource<'session-diagnostics'>(address)
  const data = resource.value
  const busy = resource.status === 'loading' || resource.status === 'none'
  const ready = resource.status === 'live' && data !== undefined
  const groups = data?.groups ?? []
  const focused = focus === undefined ? undefined : groups.find(group => group.occurrences.some(
    item => item.sessionId === focus.sessionId && item.eventSeq === focus.eventSeq,
  ))
  const current = detail === undefined && scope === '@session' ? focused : groups.find(group => group.id === detail)
  const chosen = groups.filter(group => selected.has(group.id))
  function changed(): void { setMode('list'); setSelected(new Set()); setDetail(null) }
  function reload(next: 'list' | 'refresh'): void { setMode(next); setRevision(value => value + 1); setNotice('') }
  function prepare(items: readonly DiagnosticGroup[]): void {
    if (!ready || items.length === 0) return
    setPreview(diagnosticReport(data, items, t('reportTitle'), t('reportIncomplete')))
    setNotice('')
  }
  function open(id: SessionId): void {
    try { openSession(id); close() }
    catch (_error) { setNotice(t('unavailable')) }
  }
  const date = (time: number): string => new Date(time).toLocaleString()
  return <section className={css.page}>
    <header className={css.header}>
      <div className={css.heading}><h2>{t('title')}</h2><p>{t('intro')}</p></div>
      <div className={css.actions}>
        <Button disabled={busy} onClick={() => { reload('refresh') }}>{t('refresh')}</Button>
        <Button variant="outline" disabled={!ready || groups.length === 0} onClick={() => { prepare(chosen.length > 0 ? chosen : groups) }}>
          {chosen.length > 0 ? t('exportSelected', { count: chosen.length }) : t('export')}
        </Button>
      </div>
    </header>
    <div className={css.filters}>
      <label className={css.field}><span>{t('scope')}</span><Select aria-label={t('scope')} value={scope}
        options={[{ value: '', label: t('all') }, ...(focus === undefined ? [] : [{ value: '@session', label: t('focusedSession') }]), ...(currentCwd === undefined || workspaces.some(item => item.path === currentCwd) ? [] : [{ value: currentCwd, label: currentCwd }]), ...workspaces.map(item => ({ value: item.path, label: item.title || item.path }))]}
        onValueChange={(value) => { setScope(value); changed() }} /></label>
      <label className={css.field}><span>{t('category')}</span><Select aria-label={t('category')} value={category}
        options={[{ value: '', label: t('allCategories') }, ...categories.map(value => ({ value, label: t(value) }))]}
        onValueChange={(value) => { setCategory(categories.find(item => item === value) ?? ''); changed() }} /></label>
      <label className={css.field}><span>{t('time')}</span><Select aria-label={t('time')} value={period}
        options={[{ value: '0', label: t('anytime') }, { value: '1', label: t('day') }, { value: '7', label: t('week') }, { value: '30', label: t('month') }]}
        onValueChange={(value) => { setPeriod(value); setSince(value === '0' ? undefined : Date.now() - Number(value) * 86_400_000); changed() }} /></label>
      <label className={`${css.field} ${css.search}`}><span>{t('search')}</span>
        <Input value={search} onChange={(event) => { setSearch(event.currentTarget.value); changed() }} placeholder={t('search')} /></label>
    </div>
    {busy && <p className={css.empty} role="status">{t('loading')}</p>}
    {resource.status === 'failed' && <div className={css.notice} role="alert">{t('failed')} <Button onClick={() => { reload('list') }}>{t('reload')}</Button></div>}
    {notice !== '' && <p className={css.notice} role="alert">{notice}</p>}
    {data !== undefined && <>
      <p className={css.muted}>{t('coverage', { sessions: data.scannedSessions, events: data.scannedEvents })}</p>
      {data.incomplete && <p className={css.notice} role="status">{t('incomplete', { unindexed: data.unindexedSessions, omitted: data.omittedOccurrences, failed: data.failedSessions })}</p>}
      {ready && scope === '@session' && focused === undefined && <p className={css.notice} role="status">{t('focusUnavailable')}</p>}
      {!busy && groups.length === 0 && <p className={css.empty}>{t('empty')}</p>}
      <div className={css.list}>{groups.map(group => <article className={css.card} key={group.id} data-selected={current?.id === group.id}>
        <label className={css.checkbox}><input type="checkbox" aria-label={`${t('select')}: ${group.message}`} checked={selected.has(group.id)}
          onChange={(event) => {
            const next = new Set(selected)
            if (event.currentTarget.checked) next.add(group.id)
            else next.delete(group.id)
            setSelected(next)
          }} /></label>
        <button type="button" className={css.open} aria-expanded={current?.id === group.id} onClick={() => { setDetail(current?.id === group.id ? null : group.id) }}>
          <span className={css.meta}>{t(group.category)} · {group.source} · {group.code}</span>
          <span className={css.message}>{group.message}</span>
          <span className={css.meta}>{t('count', { count: group.count })} · {t('last', { time: date(group.lastAt) })}</span>
        </button>
      </article>)}</div>
      {current !== undefined && <section className={css.detail} aria-label={t('details')}>
        <div className={css.header}><h3>{t('details')}</h3><Button disabled={!ready} onClick={() => { prepare([current]) }}>{t('exportGroup')}</Button></div>
        <p className={css.muted}>{t('unknown')}</p>
        {current.occurrences.map(item => <article className={css.occurrence} key={item.id}>
          <div className={css.meta}><time dateTime={new Date(item.at).toISOString()}>{date(item.at)}</time><span>{t('event', { seq: item.eventSeq, turn: item.turn ?? '—' })}</span></div>
          <pre className={css.pre}>{item.details}</pre>
          <Button onClick={() => { open(item.sessionId) }}>{t('source')}</Button>
        </article>)}
      </section>}
    </>}
    <Modal open={preview !== null} onClose={() => { setPreview(null) }} title={t('preview')} closeLabel={t('close')}
      description={t('privacy')} footer={<><Button onClick={() => { setPreview(null) }}>{t('cancel')}</Button>
        <Button variant="primary" onClick={() => { if (preview === null) return; try { downloadDiagnosticReport(preview); setPreview(null) } catch (_error) { setNotice(t('exportFailed')); setPreview(null) } }}>{t('download')}</Button></>}>
      <p className={css.muted}>{t('include')}</p><div className={css.preview}><pre className={css.pre}>{preview?.json}</pre></div>
    </Modal>
  </section>
}
