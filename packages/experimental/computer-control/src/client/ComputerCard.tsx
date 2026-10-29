/** Computer-control configuration on the plugin detail page. @module */

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
 * Render new-Session defaults and the live approval policy.
 * @param props - staged controls, localized copy, and form actions.
 * @returns the settings form.
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
        <fieldset className={css.group}>
          <Checkbox label={t('requireInputApproval')} checked={state.requireInputApproval} disabled={disabled}
            onChange={(checked) => { props.edit('requireInputApproval', String(checked)) }} />
          <p className={css.hint}>{t('approvalHint')}</p>
          <Checkbox label={t('showOverlay')} checked={state.showOverlay} disabled={disabled}
            onChange={(checked) => { props.edit('showOverlay', String(checked)) }} />
          <Checkbox label={t('screenshots')} checked={state.screenshots} disabled={disabled}
            onChange={(checked) => { props.edit('screenshots', String(checked)) }} />
          <p className={css.hint}>{t('screenshotsHint')}</p>
        </fieldset>
        <fieldset className={css.group}>
          <p className={css.hint}>{t('desktopHint')}</p>
          <p className={css.hint}>{t('permissions')}</p>
        </fieldset>
        <details className={css.advanced}>
          <summary className={css.heading}>{t('advancedSettings')}</summary>
          <fieldset className={css.group}>
            {(['operationTimeoutMs', 'navigationTimeoutMs'] as const).map(field => (
              <SettingsValueField key={field} id={`${id}-${field}`} label={t(field)} hint={t('timeoutHint')}
                overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')}
                {...state[field]} disabled={disabled} numeric showOverride={false}
                onEdit={(text) => { props.edit(field, text) }} onReset={() => { props.resetField(field) }} />
            ))}
          </fieldset>
          <fieldset className={css.group}>
            <SettingsValueField id={`${id}-nativeTreeTimeoutMs`} label={t('nativeTreeTimeoutMs')} hint={t('nativeTreeTimeoutMsHint')}
              overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')}
              {...state.nativeTreeTimeoutMs} disabled={disabled} numeric showOverride={false}
              onEdit={(text) => { props.edit('nativeTreeTimeoutMs', text) }} onReset={() => { props.resetField('nativeTreeTimeoutMs') }} />
          </fieldset>
        </details>
      </SettingsForm>
    </div>
  )
}
