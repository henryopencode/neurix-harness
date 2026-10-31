/** Application menu with direct phone connection and local feedback entries. @module */
import { useState } from 'react'
import { Button, Menu, Modal, Tooltip, IconSettingsOutlineMedium,
  IconPaperPlaneOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './NeurixMenu.module.css'

/** Settings navigation and localized menu labels. */
export type NeurixMenuProps = PropsRuntime<'settings.launcher'> & PropsLocale<'settings.mobileAccess'>

/**
 * Render settings navigation and an inactive feedback entry without account login.
 * @param props - settings navigation and localized labels.
 * @returns application menu without account forms or external feedback links.
 */
export function NeurixMenu({ wide, openSettings, settingsShortcut, t }: NeurixMenuProps) {
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<'feedback'>()
  return <div className={css.root}>
    <Menu open={open} side="top" portal autoFocus className={css.anchor} minWidthFromAnchor={wide}
      onClose={() => { setOpen(false) }}
      anchor={<Tooltip label={t('settings')} disabled={wide || open} side="right">
        <button type="button" className={css.trigger} data-collapsed={!wide}
          aria-label={t('settings')} aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
          <IconSettingsOutlineMedium size={wide ? 16 : 18} />{wide && <span className={css.label}>{t('settings')}</span>}
        </button>
      </Tooltip>}
      items={[
        { id: 'settings', label: t('settings'), icon: <IconSettingsOutlineMedium size={16} />,
          ...settingsShortcut === undefined ? {} : { shortcut: settingsShortcut } },
        { id: 'feedback', label: t('feedback'), icon: <IconPaperPlaneOutlineMedium size={16} /> },
      ]} onSelect={(id) => {
        setOpen(false)
        if (id === 'settings') openSettings()
        else if (id === 'feedback') setDialog('feedback')
      }} />
    {dialog === 'feedback' && <Modal open title={t('feedback')} closeLabel={t('close')} onClose={() => { setDialog(undefined) }}>
      <p>{t('feedbackUnavailable')}</p><Button onClick={() => { setDialog(undefined) }}>{t('close')}</Button>
    </Modal>}

  </div>
}
