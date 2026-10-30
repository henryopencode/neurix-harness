/** Account-free connection link and QR panel in the application menu. @module */
import { useEffect, useRef, useState } from 'react'
import { Button, IconLoadingOutlineRegular, useClipboardCopy } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MobileAccessState } from '../types.ts'
import css from './MobileAccessRow.module.css'

/** Completed connection actions reported by the persistent menu host. */
export type MobileAccessOutcome = 'opened' | 'closed' | 'updated' | 'failed'

/** Connection actions supplied by the generated Remote registration. */
export interface MobileAccessRowInjected {
  open: (host: string) => Promise<MobileAccessState>
  close: () => Promise<MobileAccessState>
  regenerate: () => Promise<MobileAccessState>
  onOutcome: (outcome: MobileAccessOutcome) => void
  disconnectPhone: () => Promise<void>
}

/** Menu panel, framework resource hook, locale, and connection action props. */
export type MobileAccessRowProps = PropsRuntime<'plugins.bundle.config'> & PropsLocale<'settings.mobileAccess'>
  & InjectFace<MobileAccessRowInjected>

/**
 * Render the saved connection link, QR code, explicit rotation, and access switch.
 * @param props - localized copy and same-Host connection actions.
 * @returns a panel that preserves the displayed link when an operation fails.
 */
export function MobileAccessRow({ view, open, close, regenerate, disconnectPhone, useResource, onOutcome, t }: MobileAccessRowProps) {
  const resource = useResource<'mobile-access'>('dsh-resource://mobile-access/connection')
  const state = resource.value
  const [host, setHost] = useState('')
  const [busy, setBusy] = useState(false)
  const mounted = useRef(false)
  const copy = useClipboardCopy(state?.connection?.url ?? '')
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const update = async (operation: () => Promise<MobileAccessState>, outcome: MobileAccessOutcome): Promise<void> => {
    setBusy(true)
    try { await operation(); onOutcome(outcome) }
    catch (_error) { onOutcome('failed') }
    finally { if (mounted.current) setBusy(false) }
  }
  if (view === 'summary') return t('description')
  const internet = state?.mode === 'internet'
  const selected = internet ? '127.0.0.1'
    : state?.networks.some(network => network.host === host) ? host : state?.networks[0]?.host ?? ''
  return <section className={css.row} aria-label={t('title')} aria-busy={busy || resource.status === 'loading'}>
    {resource.status === 'failed' && <div className={css.error} role="alert">{t('loadFailed')}</div>}
    {state === undefined && resource.status === 'failed' ? null : state === undefined ? <div className={css.loading}><IconLoadingOutlineRegular className={css.spinner} /></div>
      : state.phone ? <><p className={css.hint}>{t('computerRequired')}</p>
        <Button onClick={() => { void disconnectPhone().catch(() => { onOutcome('failed') }) }}>{t('disconnectPhone')}</Button></>
        : <>
          <p className={css.hint}>{t(internet ? 'internetHint' : 'hint')}</p>
          {state.connection === undefined ? <div className={css.controls}>
            {!internet && selected !== '' && <select className={css.network} aria-label={t('network')} value={selected}
              disabled={busy} onChange={(event) => { setHost(event.target.value) }}>
              {state.networks.map(network => <option key={network.host} value={network.host}>{network.name} · {network.host}</option>)}
            </select>}
            {!internet && selected === '' && <p className={css.hint}>{t('empty')}</p>}
            {selected !== '' && <Button variant="primary" disabled={busy}
              onClick={() => { void update(() => open(selected), 'opened') }}>{t('start')}</Button>}
          </div> : <>
            <div className={css.connected}>
              <img className={css.qr} src={state.connection.qrCode} alt={t('qr')} width={192} height={192} />
              <div className={css.details}>
                <input className={css.link} aria-label={t('link')} value={state.connection.url} readOnly
                  onFocus={(event) => { event.currentTarget.select() }} />
                <div className={css.controls}>
                  <Button variant="primary" onClick={copy.onCopy}>{t(copy.copied ? 'copied' : 'copy')}</Button>
                  <Button variant="outline" disabled={busy} onClick={() => { void update(regenerate, 'updated') }}>{t('regenerate')}</Button>
                  <Button disabled={busy} onClick={() => { void update(close, 'closed') }}>{t('stop')}</Button>
                </div>
              </div>
            </div>
            <p className={css.hint}>{t('linkHint')}</p>
            {!state.connection.encrypted && <p className={css.hint}>{t('unencrypted')}</p>}
          </>}
        </>}
  </section>
}
