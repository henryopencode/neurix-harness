/**
 * Staged Team model candidates and Lead selection.
 * @module
 */
import { SettingsFormModel, settingsNumberField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsFieldState, SettingsFormActions, SettingsFormScope, SettingsFormShell, SettingsFieldSpec } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { z } from 'zod'
import type { TeamModel } from '@deepseek-ai/dsh-experimental-agent-team/client'
const memberSchema = z.object({
  name: z.string(), label: z.string(), provider: z.string(), model: z.string(), strengths: z.string(),
}).strict()

/**
 * Unwrapped Host defaults edited through the plugin details page.
 */
export interface TeamSettingsValues {
  leaderModel: string
  models: TeamModel[]
  maxParallel: number
}

/**
 * One staged form; member JSON is internal serialization, never an editor surface.
 */
export interface TeamSettingsState extends SettingsFormShell {
  leaderModel: SettingsFieldState
  models: TeamModel[]
  maxParallel: SettingsFieldState
}

/**
 * Browser actions supplied to the plugin settings component.
 */
export interface TeamSettingsFace extends SettingsFormActions {
  hooks: { teamSettings: SnapshotStore<TeamSettingsState> }
  /**
   * @param models - Selected exact routes.
   * @param leaderModel - Selected member alias.
   */
  setModels(models: TeamModel[], leaderModel: string): void
}

const modelsField: SettingsFieldSpec = {
  field: 'models', format: value => JSON.stringify(value ?? []),
  parse: (text) => {
    try { const decoded: unknown = JSON.parse(text); return { kind: 'set', value: memberSchema.array().parse(decoded) } }
    catch (_error) { return undefined /* An invalid staged member list cannot be submitted. */ }
  },
}

/**
 * Bind Team candidate models to the shared staged form.
 */
export class TeamSettingsController {
  private readonly form: SettingsFormModel<TeamSettingsValues>
  private readonly store: SnapshotStore<TeamSettingsState>

  /**
   * @param scope - One Host-owned plugin entry's effective configuration.
   */
  constructor(scope: SettingsFormScope<TeamSettingsValues>) {
    const number = settingsNumberField('maxParallel')
    this.form = new SettingsFormModel(scope, [
      { field: 'leaderModel', format: value => typeof value === 'string' ? value : '', parse: text => ({ kind: 'set', value: text }) },
      modelsField,
      { ...number, parse: text => /^[1-9]\d*$/.test(text) && Number.isSafeInteger(Number(text)) ? { kind: 'set', value: Number(text) } : undefined },
    ])
    this.store = this.form.bind(() => {
      const write = modelsField.parse(this.form.field('models').text)
      const models = write?.kind === 'set' ? memberSchema.array().parse(write.value) : []
      return { ...this.form.shell(), leaderModel: this.form.field('leaderModel'), models, maxParallel: this.form.field('maxParallel') }
    })
  }

  /**
   * Bind the defaults editor to the plugin details page.
   * @returns Shared form actions and the current settings snapshot.
   */
  inject(): TeamSettingsFace {
    const actions = this.form.actions()
    return { ...actions, hooks: { teamSettings: this.store }, setModels: (models, leaderModel) => {
      actions.edit('models', JSON.stringify(models)); actions.edit('leaderModel', leaderModel)
    } }
  }
  /**
   * Release subscriptions without saving drafts.
   */
  dispose(): void { this.form.dispose() }
}
