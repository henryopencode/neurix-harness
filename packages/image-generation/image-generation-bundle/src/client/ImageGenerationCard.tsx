/** Configuration displayed on the optional image-generation bundle's detail page. @module */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { useId } from 'react'
import { Checkbox, SettingsForm, SettingsSecretField, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImageGenerationCardFace } from './image-generation-controller.ts'
import { formLabels } from './locales.ts'

const ASPECT_RATIOS = [
  ['1:1', 'ratioSquare', 1, 1], ['16:9', 'ratioLandscape', 16, 9], ['9:16', 'ratioPortrait', 9, 16],
  ['4:3', 'ratioLandscapeFourThree', 4, 3], ['3:4', 'ratioPortraitThreeFour', 3, 4],
  ['3:2', 'ratioLandscapeThreeTwo', 3, 2], ['2:3', 'ratioPortraitTwoThree', 2, 3], ['21:9', 'ratioUltrawide', 21, 9],
] as const

/** Display an existing pixel size as its matching ratio without rewriting the saved value. */
function selectedRatio(size: string): string {
  const dimensions = /^(\d+)x(\d+)$/u.exec(size)
  if (dimensions === null) return size
  const width = Number(dimensions[1])
  const height = Number(dimensions[2])
  return ASPECT_RATIOS.find(([, , across, down]) => width * down === height * across)?.[0] ?? size
}

/** Values and actions supplied by the slot renderer. */
export type ImageGenerationCardProps = PropsRuntime<'plugins.bundle.config'>
  & PropsLocale<'settings.imageGeneration'> & InjectFace<ImageGenerationCardFace>

/**
 * Render custom image-generation parameters, credentials, and activation settings.
 * @param props - localized copy and form state/actions.
 * @returns the bundle's editable form or its unavailable notice.
 */
export function ImageGenerationCard(props: ImageGenerationCardProps) {
  const { t } = props
  const id = useId()
  const state = props.useImageGeneration(snapshot => snapshot)
  if (props.view === 'summary') return t('description')
  const disabled = !state.writable || state.saving
  const native = state.provider.text === 'minimax'
  const ratio = selectedRatio(state.size.text)
  const choices = [
    { value: '', label: t('ratioAuto') },
    ...ASPECT_RATIOS.map(([value, key]) => ({ value, label: t(key) })),
    ...ratio !== '' && !ASPECT_RATIOS.some(([value]) => value === ratio)
      ? [{ value: ratio, label: state.size.text }]
      : [],
  ]
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <Checkbox checked={state.enabled} label={t('enabled')} disabled={disabled}
        onChange={(value) => { props.edit('enabled', String(value)) }} />
      {(['endpoint', 'model'] as const).map(field => (
        <SettingsValueField key={field} id={`${id}-${field}`} label={t(field)} hint={t(`${field}Hint`)}
          overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')}
          disabled={disabled} {...state[field]} showOverride={false}
          onEdit={(text) => { props.edit(field, text) }} onReset={() => { props.resetField(field) }} />
      ))}
      <SettingsSecretField id={`${id}-key`} label={t('apiKey')} hint={t('apiKeyHint')}
        text={state.apiKey.text} configured={state.apiKeyConfigured} disabled={disabled}
        stateLabel={state.apiKeyConfigured ? t('apiKeySet') : t('apiKeyUnset')}
        onEdit={(text) => { props.edit('apiKey', text) }} />
      <SettingsValueField id={`${id}-size`} label={t(native ? 'aspectRatio' : 'size')}
        hint={t(native ? 'aspectRatioHint' : 'sizeHint')}
        overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')}
        disabled={disabled} {...state.size} text={native ? ratio : state.size.text}
        {...native ? { choices } : {}} showOverride={false}
        onEdit={(text) => { props.edit('size', text) }} onReset={() => { props.resetField('size') }} />
      {!native && (
        <SettingsValueField id={`${id}-quality`} label={t('quality')} hint={t('qualityHint')}
          overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')}
          disabled={disabled} {...state.quality} showOverride={false}
          onEdit={(text) => { props.edit('quality', text) }} onReset={() => { props.resetField('quality') }} />
      )}
    </SettingsForm>
  )
}
