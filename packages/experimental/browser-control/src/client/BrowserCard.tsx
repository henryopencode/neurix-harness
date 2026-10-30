/** Independent hidden-browser settings on the plugin detail page. @module */

import { useId } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { Checkbox, SettingsForm, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowserCardFace } from './controller.ts'
import { formLabels } from './locales.ts'
import css from './BrowserCard.module.css'

/** Renderer-derived browser settings props. */
export type BrowserCardProps = PropsRuntime<'plugins.bundle.config'>
  & PropsLocale<'settings.browserControl'> & InjectFace<BrowserCardFace>

/**
 * Render browser selection, live approval, and model image preferences.
 * @param props - staged browser settings and form actions.
 * @returns localized configuration with timeouts under advanced settings.
 */
export function BrowserCard(props: BrowserCardProps) {
  const { t } = props
  const state = props.useBrowserCard(value => value)
  const id = useId()
  if (props.view === 'summary') return t('description')
  const disabled = !state.writable || state.saving
  return <div className={css.page}>
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <p className={css.hint}>{t('newSessions')}</p>
      <fieldset className={css.group}>
        <SettingsValueField id={`${id}-browser`} label={t('browserChannel')} hint={t('browserHint')}
          choices={(['chrome', 'chromium', 'msedge'] as const).map(value => ({ value, label: t(value) }))}
          overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')}
          {...state.browserChannel} disabled={disabled} showOverride={false}
          onEdit={(text) => { props.edit('browserChannel', text) }} onReset={() => { props.resetField('browserChannel') }} />
        <Checkbox label={t('requireInputApproval')} checked={state.requireInputApproval} disabled={disabled}
          onChange={(checked) => { props.edit('requireInputApproval', String(checked)) }} />
        <p className={css.hint}>{t('approvalHint')}</p>
        <Checkbox label={t('screenshots')} checked={state.screenshots} disabled={disabled}
          onChange={(checked) => { props.edit('screenshots', String(checked)) }} />
        <p className={css.hint}>{t('screenshotsHint')}</p>
      </fieldset>
      <details className={css.advanced}>
        <summary className={css.heading}>{t('advancedSettings')}</summary>
        <fieldset className={css.group}>
          {(['operationTimeoutMs', 'navigationTimeoutMs'] as const).map(field => <SettingsValueField
            key={field} id={`${id}-${field}`} label={t(field)} hint={t('timeoutHint')}
            overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')}
            {...state[field]} disabled={disabled} numeric showOverride={false}
            onEdit={(text) => { props.edit(field, text) }} onReset={() => { props.resetField(field) }} />)}
        </fieldset>
      </details>
    </SettingsForm>
  </div>
}
