/** Staged image-generation settings; credentials are write-only and save with the other fields. @module */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  SettingsFormModel, settingsTextField,
  type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Profile entry whose live settings this form edits. */
export const IMAGE_GENERATION_ENTRY = 'tool-image-generation'

/** Redacted settings received from the Host. */
export interface ImageGenerationSettings {
  /** Wire protocol selected for the configured endpoint. */
  provider?: 'openai' | 'minimax'
  /** Whether subsequent model requests can use generate_image. */
  enabled?: boolean
  /** Complete generation endpoint. */
  endpoint?: string
  /** Image model or deployment id. */
  model?: string
  /** Default image size or ratio. */
  size?: string
  /** Provider-specific default image quality. */
  quality?: string
}

/** Values and validation rendered by the bundle's form. */
export interface ImageGenerationCardState extends SettingsFormShell {
  /** Staged provider protocol. */
  provider: SettingsFieldState
  /** Staged generation switch. */
  enabled: boolean
  /** Endpoint input. */
  endpoint: SettingsFieldState
  /** Image model input. */
  model: SettingsFieldState
  /** Write-only credential draft. */
  apiKey: SettingsFieldState
  /** Whether the Host holds a credential, without returning its value. */
  apiKeyConfigured: boolean
  /** Default image size or ratio. */
  size: SettingsFieldState
  /** Default quality input. */
  quality: SettingsFieldState
}

/** Form actions and the snapshot bound by the slot renderer. */
export interface ImageGenerationCardFace extends SettingsFormActions {
  hooks: {
    /** Image-generation form snapshot. */
    imageGeneration: SnapshotStore<ImageGenerationCardState>
  }
}

/** Stages one revision-fenced save and reads credential presence from the shared describe mirror. */
export class ImageGenerationCardController {
  private readonly form: SettingsFormModel<ImageGenerationSettings>
  private readonly store: SnapshotStore<ImageGenerationCardState>
  private readonly unsubscribe: () => void

  /**
   * @param scope - shared form for the image-generation entry.
   * @param describe - shared redacted Host view, including credential presence.
   */
  constructor(scope: SettingsFormScope<ImageGenerationSettings>, private readonly describe: SettingsDescribeFace) {
    this.form = new SettingsFormModel(scope, [
      {
        field: 'provider', format: value => typeof value === 'string' ? value : 'openai',
        parse: text => text === 'openai' || text === 'minimax' ? { kind: 'set', value: text } : undefined,
      },
      {
        field: 'enabled', format: value => String(value === true),
        parse: text => text === 'true' || text === 'false' ? { kind: 'set', value: text === 'true' } : undefined,
      },
      settingsTextField('endpoint'), settingsTextField('model'), settingsTextField('size'), settingsTextField('quality'),
      { ...settingsTextField('apiKey'), format: () => '' },
    ])
    this.store = this.form.bind(() => this.projection())
    this.unsubscribe = describe.subscribe(() => { this.store.set(this.projection()) })
  }

  private projection(): ImageGenerationCardState {
    const shell = this.form.shell()
    const enabled = this.form.field('enabled').text === 'true'
    const endpoint = this.form.field('endpoint')
    const model = this.form.field('model')
    const apiKey = this.form.field('apiKey')
    const apiKeyConfigured = this.describe.getSnapshot().view?.namespaces
      .find(entry => entry.ns === IMAGE_GENERATION_ENTRY)?.secrets
      .some(secret => secret.path.length === 1 && secret.path[0] === 'apiKey' && secret.set) ?? false
    return {
      ...shell,
      provider: this.form.field('provider'),
      enabled, endpoint, model, apiKey, apiKeyConfigured,
      size: this.form.field('size'), quality: this.form.field('quality'),
      invalid: shell.invalid || enabled && (endpoint.text.trim() === '' || model.text.trim() === ''
        || !apiKeyConfigured && apiKey.text.trim() === ''),
    }
  }

  /**
   * Expose the live form to its configuration slot.
   * @returns the form snapshot and staged edit actions.
   */
  inject(): ImageGenerationCardFace {
    return {
      hooks: { imageGeneration: this.store }, ...this.form.actions(),
    }
  }

  /** Release form and describe subscriptions. */
  dispose(): void { this.unsubscribe(); this.form.dispose() }
}
