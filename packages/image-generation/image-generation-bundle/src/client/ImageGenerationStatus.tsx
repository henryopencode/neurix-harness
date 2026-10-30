/** Bundle-card status derived from saved image-generation settings. @module */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IMAGE_GENERATION_ENTRY } from './image-generation-controller.ts'

/** Saved configuration supplied by the feature's registration. */
export type ImageGenerationStatusProps = PropsRuntime<'plugins.bundle.status'>
  & PropsLocale<'settings.imageGeneration'>
  & InjectFace<{ hooks: { configurations: HostObservable<SettingsMirrorSnapshot> } }>

/**
 * Display disabled or incomplete image-generation settings without exposing credentials.
 * @param props - bundle selection, localized labels, and redacted saved settings.
 * @returns a status tag, or no tag when configured or when the settings snapshot or namespace is unavailable.
 */
export function ImageGenerationStatus(props: ImageGenerationStatusProps) {
  const snapshot = props.useConfigurations(state => state)
  if (!props.pkg.enabled) return <Tag className={props.className} tone="neutral">{props.t('statusDisabled')}</Tag>
  if (snapshot.status !== 'ready') return null
  const configuration = snapshot.view?.namespaces.find(entry => entry.ns === IMAGE_GENERATION_ENTRY)
  if (configuration === undefined) return null
  const values = configuration.value
  const apiKeyConfigured = configuration.secrets.some(secret => secret.path.length === 1 && secret.path[0] === 'apiKey' && secret.set)
  const ready = values !== null && typeof values === 'object' && !Array.isArray(values)
    && values.enabled === true
    && typeof values.endpoint === 'string' && values.endpoint.trim() !== ''
    && typeof values.model === 'string' && values.model.trim() !== ''
    && apiKeyConfigured
  return ready ? null : <Tag className={props.className} tone="warning">{props.t('statusNeedsSetup')}</Tag>
}
