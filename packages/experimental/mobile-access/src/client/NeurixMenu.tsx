/** Application identity and feedback entry, independent from model-provider login. @module */
import { useEffect, useRef, useState } from 'react'
import { Button, Menu, Modal, IconEllipsisOutlineMedium, IconSettingsOutlineMedium,
  IconUserOutlineMedium, IconPaperPlaneOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NeurixAccountState } from '../types.ts'
import css from './NeurixMenu.module.css'

/** Account operations supplied by the generated Remote registration. */
export interface NeurixMenuInjected {
  loadAccount: () => Promise<NeurixAccountState>
  register: (username: string, password: string) => Promise<NeurixAccountState>
  signIn: (username: string, password: string) => Promise<NeurixAccountState>
  signOut: () => Promise<NeurixAccountState>
}

/** Derived settings launcher and account action props. */
export type NeurixMenuProps = PropsRuntime<'settings.launcher'> & PropsLocale<'settings.mobileAccess'> & InjectFace<NeurixMenuInjected>

/**
 * Render the Neurix account menu, local account form, and inactive feedback channel.
 * @param props - settings navigation, locale, and account operations.
 * @returns the application account launcher with no DeepSeek authorization or feedback links.
 */
export function NeurixMenu({ wide, openSettings, settingsShortcut, loadAccount, register, signIn, signOut, t }:
NeurixMenuProps) {
  const [account, setAccount] = useState<NeurixAccountState>()
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<'account' | 'feedback'>()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const mounted = useRef(false)
  useEffect(() => {
    let current = true
    mounted.current = true
    void loadAccount().then((value) => { if (current) setAccount(value) }).catch(() => { if (current) setFailed(true) })
    return () => { current = false; mounted.current = false }
  }, [loadAccount])
  const update = async (operation: () => Promise<NeurixAccountState>): Promise<void> => {
    setBusy(true)
    setFailed(false)
    try {
      const next = await operation()
      if (mounted.current) { setAccount(next); setPassword(''); setDialog(undefined) }
    } catch (_error) { if (mounted.current) setFailed(true) }
    finally { if (mounted.current) setBusy(false) }
  }
  const dismiss = (): void => { if (!busy) { setDialog(undefined); setPassword(''); setFailed(false) } }
  return <div className={css.root}>
    <Menu open={open} side="top" portal autoFocus className={css.anchor} minWidthFromAnchor={wide}
      onClose={() => { setOpen(false) }}
      anchor={<button type="button" className={css.trigger} data-collapsed={!wide}
        aria-label={t('more')} aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        {account?.signedIn ? <IconUserOutlineMedium size={18} /> : <IconEllipsisOutlineMedium size={16} />}
        {wide && <span className={css.label}>{account?.signedIn ? account.username : t('more')}</span>}
      </button>}
      items={[
        { id: 'settings', label: t('settings'), icon: <IconSettingsOutlineMedium size={16} />,
          ...settingsShortcut === undefined ? {} : { shortcut: settingsShortcut } },
        { id: 'feedback', label: t('feedback'), icon: <IconPaperPlaneOutlineMedium size={16} /> },
        { id: 'account', label: account?.signedIn ? t('accountTitle') : t('signIn'), icon: <IconUserOutlineMedium size={16} /> },
      ]} onSelect={(id) => {
        setOpen(false)
        if (id === 'settings') openSettings()
        else { setFailed(false); setDialog(id === 'feedback' ? 'feedback' : 'account') }
      }} />
    {dialog === 'feedback' && <Modal open title={t('feedback')} closeLabel={t('close')} onClose={dismiss}>
      <p>{t('feedbackUnavailable')}</p>
      <Button onClick={dismiss}>{t('close')}</Button>
    </Modal>}
    {dialog === 'account' && <Modal open title={t('accountTitle')} closeLabel={t('close')} onClose={dismiss}>
      <div className={css.form}>
        <p className={css.hint}>{t('accountHint')}</p>
        {failed && <p role="alert" className={css.error}>{t('accountFailed')}</p>}
        {account === undefined ? <Button onClick={() => { void update(loadAccount) }}>{t('retry')}</Button>
          : account.signedIn ? <>
            <div className={css.identity}>{account.username}</div>
            <Button variant="outline" disabled={busy} onClick={() => { void update(signOut) }}>{t(account.phone ? 'signOutPhone' : 'signOut')}</Button>
          </> : <form className={css.form} onSubmit={(event) => {
            event.preventDefault()
            void update(() => account.configured ? signIn(username, password) : register(username, password))
          }}>
            <label className={css.field}>{t('username')}<input className={css.input} name="username" autoComplete="username"
              value={username} required minLength={3} maxLength={80} disabled={busy}
              onChange={(event) => { setUsername(event.target.value) }} /></label>
            <label className={css.field}>{t('password')}<input className={css.input} name="password" type="password"
              autoComplete={account.configured ? 'current-password' : 'new-password'} value={password}
              required minLength={12} maxLength={128} disabled={busy} onChange={(event) => { setPassword(event.target.value) }} /></label>
            <p className={css.hint}>{t('passwordHint')}</p>
            <div className={css.actions}>
              <Button disabled={busy} onClick={dismiss}>{t('close')}</Button>
              <Button type="submit" variant="primary" disabled={busy}>{t(account.configured ? 'signIn' : 'register')}</Button>
            </div>
          </form>}
      </div>
    </Modal>}
  </div>
}
