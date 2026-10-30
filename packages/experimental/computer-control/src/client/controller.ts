/** Staged defaults for new computer-control Sessions. @module */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsNumberField,
  type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Host entry whose settings belong to this bundle. */
export const COMPUTER_CONTROL_ENTRY = 'computer-control'
/** Bundle identity used for keyed configuration and status contributions. */
export const COMPUTER_CONTROL_BUNDLE = '@deepseek-ai/dsh-experimental-computer-control'

/** Accepted Host settings exposed by the configuration service. */
export interface ComputerSettings {
  /** Ask through the existing approval channel before each non-observation action. */
  requireInputApproval: boolean
  /** Show the desktop cursor and keyboard display. */
  showOverlay: boolean
  /** Include screenshots for image-capable models. */
  screenshots: boolean
  /** Application action deadline. */
  operationTimeoutMs: number
  /** Native accessibility walk budget. */
  nativeTreeTimeoutMs: number
  /** Application launch deadline. */
  navigationTimeoutMs: number
}

/** Staged controls and shared save state. */
export interface ComputerCardState extends SettingsFormShell {
  /** Immediate input-approval policy. */
  requireInputApproval: boolean
  /** Cursor and key indicator switch. */
  showOverlay: boolean
  /** Screenshot switch. */
  screenshots: boolean
  /** Action deadline input. */
  operationTimeoutMs: SettingsFieldState
  /** Native accessibility budget input. */
  nativeTreeTimeoutMs: SettingsFieldState
  /** Navigation deadline input. */
  navigationTimeoutMs: SettingsFieldState
}

/** Data and actions bound to the configuration slot. */
export interface ComputerCardFace extends SettingsFormActions {
  hooks: {
    /** Staged form snapshot. */
    computerCard: SnapshotStore<ComputerCardState>
  }
}

/** Revision-fenced configuration with explicit timeout validation. */
export class ComputerCardController {
  private readonly form: SettingsFormModel<ComputerSettings>
  private readonly store: SnapshotStore<ComputerCardState>

  /** @param scope - shared form for the bundle's Host entry. */
  constructor(scope: SettingsFormScope<ComputerSettings>) {
    this.form = new SettingsFormModel(scope, [
      ...['screenshots', 'showOverlay', 'requireInputApproval'].map(field => ({ field, format: (value: unknown) => String(value === true),
        parse: (text: string) => text === 'true' || text === 'false' ? { kind: 'set' as const, value: text === 'true' } : undefined })),
      ...['operationTimeoutMs', 'navigationTimeoutMs'].map(field =>
        settingsNumberField(field, { required: true, integer: true, min: 1, max: 2 ** 31 - 1 })),
      settingsNumberField('nativeTreeTimeoutMs', { required: true, integer: true, min: 100, max: 120_000 }),
    ])
    this.store = this.form.bind(() => ({
      ...this.form.shell(),
      requireInputApproval: this.form.field('requireInputApproval').text === 'true',
      showOverlay: this.form.field('showOverlay').text === 'true',
      screenshots: this.form.field('screenshots').text === 'true',
      operationTimeoutMs: this.form.field('operationTimeoutMs'), navigationTimeoutMs: this.form.field('navigationTimeoutMs'),
      nativeTreeTimeoutMs: this.form.field('nativeTreeTimeoutMs'),
    }))
  }

  /**
   * Bind staged actions and state to the configuration slot.
   * @returns staged actions and the observable consumed by the slot renderer.
   */
  inject(): ComputerCardFace { return { hooks: { computerCard: this.store }, ...this.form.actions() } }

  /** Release this form's subscription. */
  dispose(): void { this.form.dispose() }
}
