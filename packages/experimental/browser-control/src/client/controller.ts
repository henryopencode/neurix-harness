/** Staged defaults for new browser-control Sessions. @module */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsNumberField,
  type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Host entry whose settings belong to this bundle. */
export const BROWSER_CONTROL_ENTRY = 'browser-control'
/** Bundle identity used for keyed configuration and status contributions. */
export const BROWSER_CONTROL_BUNDLE = '@deepseek-ai/dsh-experimental-browser-control'

/** Accepted Host settings exposed by the configuration service. */
export interface BrowserSettings {
  /** Ask through the existing approval channel before each non-observation action. */
  requireInputApproval: boolean
  /** Installed browser distribution. */
  browserChannel: 'chrome' | 'chromium' | 'msedge'
  /** Include screenshots for image-capable models. */
  screenshots: boolean
  /** Application action deadline. */
  operationTimeoutMs: number
  /** Application launch deadline. */
  navigationTimeoutMs: number
}

/** Staged controls and shared save state. */
export interface BrowserCardState extends SettingsFormShell {
  /** Immediate input-approval policy. */
  requireInputApproval: boolean
  /** Installed browser distribution selector. */
  browserChannel: SettingsFieldState
  /** Screenshot switch. */
  screenshots: boolean
  /** Action deadline input. */
  operationTimeoutMs: SettingsFieldState
  /** Navigation deadline input. */
  navigationTimeoutMs: SettingsFieldState
}

/** Data and actions bound to the configuration slot. */
export interface BrowserCardFace extends SettingsFormActions {
  hooks: {
    /** Staged form snapshot. */
    browserCard: SnapshotStore<BrowserCardState>
  }
}

/** Revision-fenced configuration with explicit timeout validation. */
export class BrowserCardController {
  private readonly form: SettingsFormModel<BrowserSettings>
  private readonly store: SnapshotStore<BrowserCardState>

  /** @param scope - shared form for the bundle's Host entry. */
  constructor(scope: SettingsFormScope<BrowserSettings>) {
    this.form = new SettingsFormModel(scope, [
      { field: 'browserChannel', format: value => typeof value === 'string' ? value : '',
        parse: text => ['chrome', 'chromium', 'msedge'].includes(text) ? { kind: 'set', value: text } : undefined },
      ...['screenshots', 'requireInputApproval'].map(field => ({ field, format: (value: unknown) => String(value === true),
        parse: (text: string) => text === 'true' || text === 'false' ? { kind: 'set' as const, value: text === 'true' } : undefined })),
      ...['operationTimeoutMs', 'navigationTimeoutMs'].map(field =>
        settingsNumberField(field, { required: true, integer: true, min: 1, max: 2 ** 31 - 1 })),
    ])
    this.store = this.form.bind(() => ({
      ...this.form.shell(),
      requireInputApproval: this.form.field('requireInputApproval').text === 'true',
      browserChannel: this.form.field('browserChannel'),
      screenshots: this.form.field('screenshots').text === 'true',
      operationTimeoutMs: this.form.field('operationTimeoutMs'), navigationTimeoutMs: this.form.field('navigationTimeoutMs'),
    }))
  }

  /**
   * Bind staged actions and state to the configuration slot.
   * @returns staged actions and the observable consumed by the slot renderer.
   */
  inject(): BrowserCardFace { return { hooks: { browserCard: this.store }, ...this.form.actions() } }

  /** Release this form's subscription. */
  dispose(): void { this.form.dispose() }
}
