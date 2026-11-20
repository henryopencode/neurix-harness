/** Model setup entry in the blank-session composer. */
import { useEffect } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { onboardingReadiness, type ModelsSettingsState } from './store.ts'
import type { ModelsKey } from './locales.ts'

/** Shared Models state and settings-shell navigation for the setup entry. */
export interface ModelSetupActionInjected {
  hooks: { models: SnapshotStore<ModelsSettingsState> }
  load: () => void
  open: () => void
  t: (key: ModelsKey) => string
}

/**
 * Offer model setup when there is no usable provider and setup is available.
 * @param props - the Models join and settings navigation bound at registration.
 * @returns the setup button, or null while setup is unavailable or unneeded.
 */
export function ModelSetupAction({ useModels, load, open, t }: InjectFace<ModelSetupActionInjected>) {
  const state = useModels(snapshot => snapshot)
  useEffect(() => {
    if (state.status === 'idle') load()
  }, [load, state.status])
  if (onboardingReadiness(state).kind !== 'credential-missing') return null
  return <Button variant="outline" size="sm" aria-haspopup="dialog" onClick={open}>{t('configureModel')}</Button>
}
