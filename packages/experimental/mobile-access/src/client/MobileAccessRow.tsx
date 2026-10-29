/** Private phone pairing in the existing General settings. @module */
import { useEffect, useRef, useState } from 'react'
import { Button, IconLoadingOutlineRegular, useClipboardCopy } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MobileAccessState } from '../types.ts'
import css from './MobileAccessRow.module.css'

/** Owner actions injected by the Client registration. */
export interface MobileAccessRowInjected {
  load: () => Promise<MobileAccessState>
  open: (host: string) => Promise<MobileAccessState>
  close: () => Promise<MobileAccessState>
}

/** Derived slot, locale, and injected action props. */
export type MobileAccessRowProps = PropsRuntime<'settings.general.item'> & PropsLocale<'settings.mobileAccess'>
  & InjectFace<MobileAccessRowInjected>

/**
 * Render network choice, a private connection QR code, and explicit disconnection.
 * @param props - localized copy and same-Host connection actions.
 * @returns a General settings row without automatic text-field focus.
 */
export function MobileAccessRow({ load, open, close, t }: MobileAccessRowProps) {
  const [state, setState] = useState<MobileAccessState>()
  const [host, setHost] = useState('')
  const [busy, setBusy] = useState(true)
  const [failed, setFailed] = useState(false)
  const mounted = useRef(false)
  const copy = useClipboardCopy(state?.connection?.url ?? '')
  useEffect(() => {
    let current = true
    mounted.current = true
    void load().then((next) => { if (current) setState(next) })
      .catch(() => { if (current) setFailed(true) })
      .finally(() => { if (current) setBusy(false) })
    return () => { current = false; mounted.current = false }
  }, [load])
  const update = async (operation: () => Promise<MobileAccessState>): Promise<void> => {
    setBusy(true)
    setFailed(false)
    try {
      const next = await operation()
      if (mounted.current) setState(next)
    } catch (_error) {
      if (mounted.current) {
        setFailed(true)
        void load().then((refreshed) => { if (mounted.current) setState(refreshed) })
          .catch(() => { if (mounted.current) setState(undefined) })
      }
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  const internet = state?.mode === 'internet'
  const selected = internet ? '127.0.0.1'
    : state?.networks.some(network => network.host === host) ? host : state?.networks[0]?.host ?? ''
  return <section className={css.row} aria-label={t('title')} aria-busy={busy}>
    <div className={css.title}>{t('title')}</div>
    <p className={css.hint}>{t(internet ? 'internetHint' : 'hint')}</p>
    {state !== undefined && !state.account.signedIn && <p className={css.hint}>{t('signInFirst')}</p>}
    {failed && <div className={css.error} role="alert">{t('failed')}</div>}
    {state === undefined && busy ? <div className={css.loading}><IconLoadingOutlineRegular className={css.spinner} /></div>
      : state?.connection === undefined
        ? <div className={css.controls}>
          {!internet && selected !== '' && <select className={css.network} aria-label={t('network')} value={selected}
            disabled={busy} onChange={(event) => { setHost(event.target.value) }}>
            {state?.networks.map(network => <option key={network.host} value={network.host}>{network.name} · {network.host}</option>)}
          </select>}
          {!internet && state !== undefined && selected === '' && <p className={css.hint}>{t('empty')}</p>}
          {selected !== '' && <Button variant="outline" disabled={busy || state?.account.signedIn !== true}
            onClick={() => { void update(() => open(selected)) }}>{t(internet ? 'internetStart' : 'start')}</Button>}
          {(failed || state !== undefined && selected === '') && <Button disabled={busy}
            onClick={() => { void update(load) }}>{t('retry')}</Button>}
        </div> : <>
          <div className={css.connected}>
            <img className={css.qr} src={state.connection.qrCode} alt={t('qr')} width={192} height={192} />
            <div className={css.details}>
              <input className={css.link} aria-label={t('link')} value={state.connection.url} readOnly
                onFocus={(event) => { event.currentTarget.select() }} />
              <div className={css.controls}>
                <Button variant="outline" onClick={copy.onCopy}>{t(copy.copied ? 'copied' : 'copy')}</Button>
                <Button disabled={busy} onClick={() => { void update(close) }}>{t(internet ? 'internetStop' : 'stop')}</Button>
              </div>
              <p className={css.hint}>{t('addHome')}</p>
            </div>
          </div>
          <p className={css.hint}>{t(state.connection.encrypted ? 'encrypted' : 'unencrypted')}</p>
        </>}
  </section>
}
