/**
 * First-run model connection over the Models page's shared provider join.
 * Custom API setup is the default when available. Every installed provider
 * appears in one selector without a featured vendor. Any usable provider ends
 * automatic onboarding.
 */
import type { TrackProductEvent } from '@deepseek-ai/dsh-client-product-analytics/client'
import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRuntime, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelsSettingsState, ModelsSettingsStore } from './store.ts'
import { onboardingReadiness, protocolChoices, reasoningLevelChoices } from './store.ts'
import type { ModelsOperations } from './operations.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import { CustomProviderCard } from './CustomProviderCard.tsx'
import type {} from './slot-contract.ts'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import styles from './DeepSeekOnboardingDialog.module.css'
import formStyles from './ModelsSection.module.css'

/** Registration-side dependencies of {@link DeepSeekOnboardingDialog}. */
export interface DeepSeekOnboardingInjected {
  /** Desktop-only event collection. */
  track?: TrackProductEvent
  /** Whether first-run setup should show automatically. Explicit requests remain available. */
  automatic: boolean
  hooks: {
    /** Shared Models-page join state, bound by the slot renderer. */
    models: SnapshotStore<ModelsSettingsState>
  }
  /** Shared Models-page join controller. */
  controller: ModelsSettingsStore
  /** The Host operations the reused Models credential editor writes through. */
  operations: ModelsOperations
  /** Settings schema and immutable path callbacks. */
  schema: SettingsSchemaOperations
  /** Feature copy. */
  t: (key: keyof typeof en) => string
}

/** Slot owner props plus the feature's injected dependencies. */
export type DeepSeekOnboardingDialogProps =
  PropsRuntime<'settings.onboarding'> & PropsRenderSlots<'settings.models.sign-in'> & InjectFace<DeepSeekOnboardingInjected>

/* v8 ignore next 3 -- closed-union defaults only defend future source widening */
function assertNever(_value: never): never {
  throw new Error('unexpected DeepSeek onboarding state')
}

/**
 * Offer writable model-service setup while no provider can serve requests.
 * @param props - settings-shell owner state and Models feature dependencies.
 * @returns the onboarding modal or null when onboarding needs no intervention.
 */
export function DeepSeekOnboardingDialog(props: DeepSeekOnboardingDialogProps): ReactNode {
  const { complete, controller, useModels, operations, schema, t, renderSlot, automatic, explicit = false } = props
  const [apiKey, setApiKey] = useState(explicit)
  const [choice, setChoice] = useState('custom')
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set(['custom']))
  const [customBusy, setCustomBusy] = useState(false)
  const [providerBusy, setProviderBusy] = useState(false)
  const id = useId()
  const state = useModels(snapshot => snapshot)
  const readiness = onboardingReadiness(state)
  const custom = state.namespaces.get('llm-pi-ai')
  const protocols = protocolChoices(custom, schema)
  const customAvailable = custom !== undefined && state.writable && state.credentialError === null && protocols.length > 0
  const providers = state.rows.flatMap((candidate) => {
    const namespace = state.namespaces.get(candidate.entry.settingsNs)
    return namespace !== undefined
      && (candidate.entry.settingsNs === 'llm-deepseek' || candidate.entry.settingsNs === 'llm-pi-ai')
      && (candidate.entry.settingsPath.length > 0 || candidate.entry.active)
      && candidate.entry.provider !== 'deepseek-account'
      && state.writable && state.credentialError === null
      && candidate.credential?.writable !== false && candidate.derivedCredential?.writable !== false
      ? [{ ...candidate, namespace }] : []
  })
    .toSorted((left, right) => left.entry.provider.localeCompare(right.entry.provider, 'en'))
  const options = [
    ...customAvailable ? [{ value: 'custom', label: t('addCustom') }] : [],
    ...providers.map(candidate => ({ value: `provider:${candidate.entry.provider}`, label: candidate.entry.displayName })),
  ]
  const mode = options.some(option => option.value === choice) ? choice : options[0]?.value

  useEffect(() => {
    if ((automatic || explicit) && state.status === 'idle') void controller.load()
  }, [controller, state.status, automatic, explicit])

  useEffect(() => {
    if (
      (!automatic && !explicit)
      || readiness.kind === 'adapter-absent'
      || (!explicit && readiness.kind === 'provider-ready')
      || readiness.kind === 'unavailable'
      || (readiness.kind !== 'loading' && options.length === 0)
    ) complete()
  }, [complete, readiness.kind, explicit, automatic, options.length])

  if (!automatic && !explicit) return null

  switch (readiness.kind) {
    case 'loading':
    case 'adapter-absent':
    case 'unavailable':
      return null
    case 'provider-ready':
      if (!explicit) return null
      break
    case 'credential-missing':
      break
    /* v8 ignore next -- every current readiness variant is handled above */
    default:
      return assertNever(readiness)
  }

  if (mode === undefined) return null
  let provider = 'custom-api'
  for (let suffix = 2; state.rows.some(candidate => candidate.entry.provider === provider); suffix++) {
    provider = `custom-api-${String(suffix)}`
  }

  const finishCredential = (changed: boolean): void => {
    if (!changed) {
      complete()
      return
    }
    void controller.load().then(() => {
      if (explicit && onboardingReadiness(controller.store.getSnapshot()).kind === 'provider-ready') complete()
    })
  }

  const editor = (
    <OnboardingModal title={t('onboardingTitle')}>
      {options.length > 1 ? <div className={formStyles['field']}>
        <label className={formStyles['fieldLabel']} htmlFor={id}>{t('provider')}</label>
        <select
          id={id}
          className={`${formStyles['input']} ${formStyles['selectInput']}`}
          value={mode}
          disabled={customBusy || providerBusy}
          onChange={(event) => {
            const next = event.target.value
            setChoice(next)
            setVisited(previous => new Set([...previous, next]))
          }}
        >
          {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div> : null}
      <p className={styles.description}>{t('onboardingDescription')}</p>
      {customAvailable && (visited.has('custom') || mode === 'custom') ? <div
        role="group"
        aria-label={t('addCustom')}
        hidden={mode !== 'custom'}
        className={styles.editor}
      >
        <CustomProviderCard
          onboarding={{ provider }}
          taken={state.rows.map(candidate => candidate.entry.provider)}
          protocols={protocols}
          reasoningLevels={reasoningLevelChoices(custom, schema)}
          revision={custom.revision}
          operations={operations}
          t={t}
          readOnly={false}
          onClose={(changed) => {
            if (changed) void controller.load()
            complete()
          }}
          onBusyChange={setCustomBusy}
        />
      </div> : null}
      {providers.map((candidate) => {
        const value = `provider:${candidate.entry.provider}`
        if (!visited.has(value) && mode !== value) return null
        const namespace = candidate.namespace
        return <div key={value} role="group" aria-label={candidate.entry.displayName}
          hidden={mode !== value} className={styles.editor}>
          <ProviderEditor
            provider={candidate.entry.provider}
            displayName={candidate.entry.displayName}
            namespace={namespace}
            schema={schema}
            settingsPath={candidate.entry.settingsPath}
            operations={operations}
            {...candidate.entry.defaultBaseURL === undefined ? {} : { defaultBaseURL: candidate.entry.defaultBaseURL }}
            {...candidate.entry.baseURLEnv === undefined ? {} : { baseURLEnv: candidate.entry.baseURLEnv }}
            {...candidate.entry.nativeAuth === undefined ? {} : { nativeAuth: candidate.entry.nativeAuth }}
            {...candidate.entry.declared === undefined ? {} : { declared: candidate.entry.declared }}
            {...candidate.credential === undefined ? {} : { credential: candidate.credential }}
            {...candidate.credentialChecks === undefined ? {} : { credentialChecks: candidate.credentialChecks }}
            t={t}
            readOnly={false}
            hideTitle
            credentialOnly={candidate.entry.settingsPath.length === 0}
            onSubmitCredential={() => { props.track?.('api_key_save_click', {}) }}
            credentialRequired={candidate.entry.settingsPath.length === 0}
            autoFocusCredential={options.length === 1}
            cancelLabelKey="onboardingLater"
            submitLabelKey="onboardingSave"
            submitBusyLabelKey="onboardingSaving"
            onClose={finishCredential}
            onBusyChange={setProviderBusy}
          />
        </div>
      })}
    </OnboardingModal>
  )
  return apiKey ? editor : renderSlot('settings.models.sign-in', { complete, useApiKey: () => { setApiKey(true) } }, { fallback: editor })
}
