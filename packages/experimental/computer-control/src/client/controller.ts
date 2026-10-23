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
  /** Browser-only background or foreground system input. */
  inputMode: 'foreground' | 'background'
  /** Show the desktop cursor and keyboard display. */
  showOverlay: boolean
  /** Pointer glide duration in milliseconds. */
  cursorMoveDurationMs: number
  /** Duration of a browser wheel gesture in milliseconds. */
  scrollDurationMs: number
  /** Delay between inserted characters in milliseconds. */
  typingDelayMs: number
  /** Idle display lifetime in milliseconds. */
  overlayIdleMs: number
  /** Installed browser distribution. */
  browserChannel: 'chrome' | 'chromium' | 'msedge'
  /** Hide owned browser windows. */
  headless: boolean
  /** Include screenshots for image-capable models. */
  screenshots: boolean
  /** Native and browser action deadline. */
  operationTimeoutMs: number
  /** Native accessibility walk budget. */
  nativeTreeTimeoutMs: number
  /** Application launch, browser startup, and navigation deadline. */
  navigationTimeoutMs: number
}

/** Staged controls and shared save state. */
export interface ComputerCardState extends SettingsFormShell {
  /** Immediate input-approval policy. */
  requireInputApproval: boolean
  /** Input delivery selector. */
  inputMode: SettingsFieldState
  /** Cursor and key indicator switch. */
  showOverlay: boolean
  /** Pointer duration input. */
  cursorMoveDurationMs: SettingsFieldState
  /** Scroll duration input. */
  scrollDurationMs: SettingsFieldState
  /** Character delay input. */
  typingDelayMs: SettingsFieldState
  /** Idle display lifetime input. */
  overlayIdleMs: SettingsFieldState
  /** Browser distribution selector. */
  browserChannel: SettingsFieldState
  /** Hidden browser switch. */
  headless: boolean
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

/** Revision-fenced configuration with explicit browser and timeout validation. */
export class ComputerCardController {
  private readonly form: SettingsFormModel<ComputerSettings>
  private readonly store: SnapshotStore<ComputerCardState>

  /** @param scope - shared form for the bundle's Host entry. */
  constructor(scope: SettingsFormScope<ComputerSettings>) {
    this.form = new SettingsFormModel(scope, [
      { field: 'inputMode', format: value => typeof value === 'string' ? value : '',
        parse: text => ['foreground', 'background'].includes(text) ? { kind: 'set', value: text } : undefined },
      { field: 'browserChannel', format: value => typeof value === 'string' ? value : '',
        parse: text => ['chrome', 'chromium', 'msedge'].includes(text) ? { kind: 'set', value: text } : undefined },
      ...['headless', 'screenshots', 'showOverlay', 'requireInputApproval'].map(field => ({ field, format: (value: unknown) => String(value === true),
        parse: (text: string) => text === 'true' || text === 'false' ? { kind: 'set' as const, value: text === 'true' } : undefined })),
      ...['operationTimeoutMs', 'navigationTimeoutMs'].map((field) => {
        const spec = settingsNumberField(field)
        return { ...spec, parse: (text: string) => {
          const value = Number(text.trim())
          return Number.isInteger(value) && value > 0 && value <= 2 ** 31 - 1 ? { kind: 'set' as const, value } : undefined
        } }
      }),
      ...([{ field: 'cursorMoveDurationMs', min: 0, max: 5000 }, { field: 'scrollDurationMs', min: 0, max: 5000 }, { field: 'typingDelayMs', min: 0, max: 200 }, { field: 'overlayIdleMs', min: 100, max: 60_000 }, { field: 'nativeTreeTimeoutMs', min: 100, max: 120_000 }]).map(({ field, min, max }) => ({
        ...settingsNumberField(field), parse: (text: string) => {
          const value = Number(text.trim())
          return text.trim() !== '' && Number.isInteger(value) && value >= min && value <= max ? { kind: 'set' as const, value } : undefined
        },
      })),
    ])
    this.store = this.form.bind(() => ({
      ...this.form.shell(), browserChannel: this.form.field('browserChannel'), inputMode: this.form.field('inputMode'),
      requireInputApproval: this.form.field('requireInputApproval').text === 'true',
      showOverlay: this.form.field('showOverlay').text === 'true',
      cursorMoveDurationMs: this.form.field('cursorMoveDurationMs'), scrollDurationMs: this.form.field('scrollDurationMs'),
      typingDelayMs: this.form.field('typingDelayMs'), overlayIdleMs: this.form.field('overlayIdleMs'),
      headless: this.form.field('headless').text === 'true', screenshots: this.form.field('screenshots').text === 'true',
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
