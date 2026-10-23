/** Configuration and ordered manual tests on the plugin detail page. @module */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { useId } from 'react'
import { Checkbox, SettingsForm, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComputerCardFace } from './controller.ts'
import { formLabels } from './locales.ts'
import css from './ComputerCard.module.css'

/** Renderer-derived configuration props. */
export type ComputerCardProps = PropsRuntime<'plugins.bundle.config'>
  & PropsLocale<'settings.computerControl'> & InjectFace<ComputerCardFace>

/**
 * Render new-Session defaults and copyable testing instructions.
 * @param props - staged controls, localized copy, and form actions.
 * @returns the settings form and manual test sequence.
 */
export function ComputerCard(props: ComputerCardProps) {
  const { t } = props
  const id = useId()
  const state = props.useComputerCard(value => value)
  if (props.view === 'summary') return t('description')
  const disabled = !state.writable || state.saving
  return (
    <div className={css.page}>
      <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
        <p className={css.hint}>{t('newSessions')}</p>
        <Checkbox label={t('requireInputApproval')} checked={state.requireInputApproval} disabled={disabled}
          onChange={(checked) => { props.edit('requireInputApproval', String(checked)) }} />
        <p className={css.hint}>{t('approvalHint')}</p>
        <SettingsValueField id={`${id}-input-mode`} label={t('inputMode')} hint={t('inputModeHint')}
          choices={(['foreground', 'background'] as const).map(value => ({ value, label: t(value) }))}
          overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')}
          {...state.inputMode} disabled={disabled} showOverride={false}
          onEdit={(text) => { props.edit('inputMode', text) }} onReset={() => { props.resetField('inputMode') }} />
        <Checkbox label={t('showOverlay')} checked={state.showOverlay} disabled={disabled}
          onChange={(checked) => { props.edit('showOverlay', String(checked)) }} />
        {(['cursorMoveDurationMs', 'scrollDurationMs', 'typingDelayMs', 'overlayIdleMs', 'nativeTreeTimeoutMs'] as const).map(field => (
          <SettingsValueField key={field} id={`${id}-${field}`} label={t(field)} hint={t(`${field}Hint`)}
            overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')}
            {...state[field]} disabled={disabled} numeric showOverride={false}
            onEdit={(text) => { props.edit(field, text) }} onReset={() => { props.resetField(field) }} />
        ))}
        <SettingsValueField id={`${id}-browser`} label={t('browserChannel')} hint={t('browserHint')}
          choices={(['chrome', 'chromium', 'msedge'] as const).map(value => ({ value, label: t(value) }))}
          overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')}
          {...state.browserChannel} disabled={disabled} showOverride={false}
          onEdit={(text) => { props.edit('browserChannel', text) }} onReset={() => { props.resetField('browserChannel') }} />
        <Checkbox label={t('headless')} checked={state.headless} disabled={disabled}
          onChange={(checked) => { props.edit('headless', String(checked)) }} />
        <Checkbox label={t('screenshots')} checked={state.screenshots} disabled={disabled}
          onChange={(checked) => { props.edit('screenshots', String(checked)) }} />
        <p className={css.hint}>{t('screenshotsHint')}</p>
        {(['operationTimeoutMs', 'navigationTimeoutMs'] as const).map(field => (
          <SettingsValueField key={field} id={`${id}-${field}`} label={t(field)} hint={t('timeoutHint')}
            overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')}
            {...state[field]} disabled={disabled} numeric showOverride={false}
            onEdit={(text) => { props.edit(field, text) }} onReset={() => { props.resetField(field) }} />
        ))}
      </SettingsForm>
      <section className={css.testing} aria-label={t('testing')}>
        <h3 className={css.heading}>{t('testing')}</h3>
        <p className={css.hint}>{t('permissions')}</p>
        <p className={css.hint}>{t('testIntro')}</p>
        {(['Inspect', 'Browser', 'Native'] as const).map(step => (
          <div className={css.step} key={step}>
            <h4 className={css.heading}>{t(`test${step}Title`)}</h4>
            {step === 'Native' ? <p className={css.hint}>{t('testNativeHint')}</p> : null}
            <textarea className={css.prompt} aria-label={t(`test${step}Title`)} value={t(`test${step}`)} readOnly rows={3}
              onFocus={(event) => { event.currentTarget.select() }} />
          </div>
        ))}
        <p className={css.hint}>{t('testNoModel')}</p>
      </section>
    </div>
  )
}
