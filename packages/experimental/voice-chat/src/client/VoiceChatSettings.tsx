/** Plugin-owned input preferences and explicit recognition/synthesis preparation. */
import { useEffect, useState } from 'react'
import { Button, Select, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { VoicePreset } from '../types.ts'
import type { VoiceChatInjected } from './VoiceChat.tsx'
import { NS } from './locales.ts'
import css from './VoiceChatSettings.module.css'

type SettingsProps = PropsRuntime<'plugins.bundle.config'> & PropsLocale<typeof NS> & InjectFace<VoiceChatInjected>
/** Configure realtime voice on its plugin page without starting a conversation or an automatic download. */
export function VoiceChatSettings({ useVoiceSetup, useVoiceState, useVoiceDevices, useVoiceInputDevice,
  useVoicePreference, refreshInputDevices, selectInputDevice, selectVoice, configureRecognition,
  prepare, cancelPreparation, t }: SettingsProps) {
  const setup = useVoiceSetup(value => value), state = useVoiceState(value => value)
  const inputs = useVoiceDevices(value => value), input = useVoiceInputDevice(value => value)
  const voicePreference = useVoicePreference(value => value)
  const [saving, setSaving] = useState(false), [saveError, setSaveError] = useState(false)
  useEffect(() => { refreshInputDevices(false) }, [refreshInputDevices])
  const catalog = setup.recognition, voice = setup.voice
  const provider = catalog?.providers.find(item => item.id === catalog.selection.providerId)
  const recognition = provider?.preparation
  const active = state.phase !== 'idle'
  const preparing = setup.recognitionPreparing || voice?.phase === 'preparing'
  const ready = setup.recognitionReady && voice?.phase === 'ready'
  const unavailable = !setup.connected || active || saving
  const devices = [{ value: '', label: t('defaultInput') }, ...inputs.devices.map((device, index) => ({
    value: device.id, label: device.label || t('inputNumber', { number: String(index + 1) }),
  }))]
  if (input.id !== '' && !devices.some(device => device.value === input.id)) {
    devices.push({ value: input.id, label: t('inputNotDetected', { name: input.label || t('savedInput') }) })
  }
  const configure = async (patch: Parameters<typeof configureRecognition>[0]): Promise<void> => {
    setSaving(true); setSaveError(false)
    try { await configureRecognition(patch) } catch (_error) { setSaveError(true) }
    finally { setSaving(false) }
  }
  const languageNames: Readonly<Record<string, string>> = {
    auto: t('language.auto'), zh: t('language.zh'), en: t('language.en'), yue: t('language.yue'),
    ja: t('language.ja'), es: t('language.es'), fr: t('language.fr'), de: t('language.de'),
    ru: t('language.ru'), pt: t('language.pt'), ko: t('language.ko'),
  }
  const synthesisStatus = !setup.connected ? t('connecting') : voice?.phase === 'unsupported' ? t('unsupported')
    : voice?.phase === 'ready' ? t('resourcesReady') : voice?.phase === 'failed' ? t('preparationFailed')
      : voice?.phase === 'preparing' ? voice.operation === 'model' ? t('downloading', {
        completed: (voice.completedBytes / 1e9).toFixed(2), total: (voice.downloadBytes / 1e9).toFixed(2),
      }) : t(voice.operation === 'python' ? 'python' : voice.operation === 'dependencies' ? 'dependencies'
        : voice.operation === 'loading' ? 'loading' : 'runtime') : t('unprepared')
  return <div className={css.settings} data-voice-chat-settings>
    <div className={css.fields}>
      <div className={css.field}><span>{t('inputDevice')}</span><div className={css.devicePicker}>
        <Select aria-label={t('inputDevice')} value={input.id} disabled={unavailable || inputs.pending} options={devices}
          onValueChange={(id) => { selectInputDevice({ id, label: inputs.devices.find(device => device.id === id)?.label ?? '' }) }} />
        <Button size="sm" variant="outline" disabled={unavailable || inputs.pending} onClick={() => { refreshInputDevices(true) }}>{t('detectInput')}</Button>
      </div></div>
      {inputs.error && <p className={css.error} role="alert">{t(`error.${inputs.error}`)}</p>}
      <div className={css.field}><span>{t('recognitionService')}</span>
        <Select aria-label={t('recognitionService')} value={catalog?.selection.providerId ?? ''} disabled={unavailable || !catalog}
          options={catalog?.providers.map(item => ({ value: item.id, label: item.name })) ?? []}
          onValueChange={(providerId) => { void configure({ providerId: providerId as SpeechProviderId }) }} />
      </div>
      <div className={css.field}><span>{t('recognitionLanguage')}</span>
        <Select aria-label={t('recognitionLanguage')} value={catalog?.selection.language ?? 'auto'} disabled={unavailable || !provider}
          options={provider?.languages.map(language => ({ value: language, label: languageNames[language] ?? language })) ?? []}
          onValueChange={(language) => { void configure({ language }) }} />
      </div>
      <div className={css.field}><span>{t('voiceModel')}</span><div className={css.model}>
        <span>{voice?.model ? t(`model.${voice.model}`) : t('unavailableModel')}</span>
        {voice?.model && <small>{t('modelSize', { gb: (voice.downloadBytes / 1e9).toFixed(1), memory: (voice.hardware.memoryBytes / 1024 ** 3).toFixed(0) })}</small>}
      </div></div>
      <div className={css.field}><span>{t('voice')}</span>
        <Select aria-label={t('voice')} value={voicePreference} disabled={unavailable}
          options={(['natural', 'warm', 'calm'] satisfies VoicePreset[]).map(voice => ({ value: voice, label: t(`voice.${voice}`) }))}
          onValueChange={(voice) => { selectVoice(voice as VoicePreset) }} />
      </div>
      {saveError && <p className={css.error} role="alert">{t('configurationFailed')}</p>}
    </div>
    {provider && <p className={css.note}>{t(provider.location === 'cloud' ? 'recognitionCloud' : 'recognitionLocal')}</p>}
    <section className={css.resource} aria-label={t('recognition')}>
      <h4>{provider?.name ?? t('recognition')}</h4>
      <div className={css.status} role="status"><StateDot appearance="step" size={16}
        state={recognition?.phase === 'failed' ? 'error' : setup.recognitionReady ? 'done' : setup.recognitionPreparing ? 'ongoing' : 'idle'} />
      <span>{!setup.connected ? t('connecting') : recognition ? t(`recognitionPhase.${recognition.phase}`) : t('recognizerMissing')}</span>
      </div>
      {recognition?.phase === 'downloading' && <progress className={css.progress} aria-label={t('recognition')}
        value={recognition.totalBytes === undefined ? undefined : recognition.completedBytes} max={recognition.totalBytes} />}
      {recognition?.phase === 'failed' && <p className={css.error} role="alert">{t('recognitionPreparationFailed', { message: recognition.message })}</p>}
    </section>
    <section className={css.resource} aria-label={t('synthesis')}>
      <h4>{voice?.model ? t(`model.${voice.model}`) : t('synthesis')}</h4>
      <div className={css.status} role="status"><StateDot appearance="step" size={16}
        state={voice?.phase === 'failed' ? 'error' : voice?.phase === 'ready' ? 'done' : voice?.phase === 'preparing' ? 'ongoing' : 'idle'} />
      <span>{synthesisStatus}</span>
      </div>
      {voice?.phase === 'preparing' && voice.operation === 'model' && <progress className={css.progress} aria-label={t('synthesis')}
        value={voice.completedBytes} max={voice.downloadBytes} />}
      {voice?.error && <p className={css.error} role="alert">{t(voice.failedStep ? `error.${voice.failedStep}` : `error.${voice.error}`)}</p>}
    </section>
    <div className={css.actions}>
      {preparing ? <Button size="sm" variant="outline" disabled={!setup.connected} onClick={cancelPreparation}>{t('cancelPrepare')}</Button>
        : !ready && <Button size="sm" variant="primary" disabled={!setup.connected || !provider || voice?.phase === 'unsupported'} onClick={prepare}>{t(voice?.phase === 'failed' || recognition?.phase === 'failed' ? 'retry' : 'prepare')}</Button>}
    </div>
    {setup.preparationError && <p className={css.error} role="alert">{t('error.connection')}</p>}
    <p className={css.note}>{t('license')}</p>
  </div>
}
