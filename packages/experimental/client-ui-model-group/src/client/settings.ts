/**
 * Revision-fenced drafts for one model group's plugin defaults.
 * @module
 */
import { SettingsFormModel, settingsNumberField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsFieldState, SettingsFormActions, SettingsFormScope, SettingsFormShell, SettingsFieldSpec } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { memberSchema } from '../schema.ts'
import type { ModelGroupMember, ModelGroupMode } from '../types.ts'

/**
 * Unwrapped Host defaults edited through the plugin details page.
 */
export interface GroupSettingsValues {
  defaultMode: ModelGroupMode
  leader: string
  members: ModelGroupMember[]
  maxParallel: number
}

/**
 * One staged form; member JSON is internal serialization, never an editor surface.
 */
export interface GroupSettingsState extends SettingsFormShell {
  defaultMode: SettingsFieldState
  leader: SettingsFieldState
  members: ModelGroupMember[]
  maxParallel: SettingsFieldState
}

/**
 * Browser actions supplied to the plugin settings component.
 */
export interface GroupSettingsFace extends SettingsFormActions {
  hooks: { groupSettings: SnapshotStore<GroupSettingsState> }
  /**
   * @param members - Selected exact routes.
   * @param leader - Selected member alias.
   */
  setMembers(members: ModelGroupMember[], leader: string): void
}

const membersField: SettingsFieldSpec = {
  field: 'members', format: value => JSON.stringify(value ?? []),
  parse: (text) => {
    try { const decoded: unknown = JSON.parse(text); return { kind: 'set', value: memberSchema.array().parse(decoded) } }
    catch (_error) { return undefined /* An invalid staged member list cannot be submitted. */ }
  },
}

/**
 * Bind model-group fields to the existing shared staged form.
 */
export class GroupSettingsController {
  private readonly form: SettingsFormModel<GroupSettingsValues>
  private readonly store: SnapshotStore<GroupSettingsState>

  /**
   * @param scope - One Host-owned plugin entry's effective configuration.
   */
  constructor(scope: SettingsFormScope<GroupSettingsValues>) {
    const number = settingsNumberField('maxParallel')
    this.form = new SettingsFormModel(scope, [
      { field: 'defaultMode', format: value => typeof value === 'string' ? value : 'multi', parse: text => text === 'single' || text === 'multi' ? { kind: 'set', value: text } : undefined },
      { field: 'leader', format: value => typeof value === 'string' ? value : '', parse: text => ({ kind: 'set', value: text }) },
      membersField,
      { ...number, parse: text => /^[1-9]\d*$/.test(text) && Number.isSafeInteger(Number(text)) ? { kind: 'set', value: Number(text) } : undefined },
    ])
    this.store = this.form.bind(() => {
      const write = membersField.parse(this.form.field('members').text)
      const members = write?.kind === 'set' ? memberSchema.array().parse(write.value) : []
      return { ...this.form.shell(), defaultMode: this.form.field('defaultMode'), leader: this.form.field('leader'), members, maxParallel: this.form.field('maxParallel') }
    })
  }

  /**
   * Bind the defaults editor to the plugin details page.
   * @returns Shared form actions and the current settings snapshot.
   */
  inject(): GroupSettingsFace {
    const actions = this.form.actions()
    return { ...actions, hooks: { groupSettings: this.store }, setMembers: (members, leader) => {
      actions.edit('members', JSON.stringify(members)); actions.edit('leader', leader)
    } }
  }
  /**
   * Release subscriptions without saving drafts.
   */
  dispose(): void { this.form.dispose() }
}
