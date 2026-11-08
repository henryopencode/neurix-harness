/**
 * Model catalog selection and editable defaults inside plugin details.
 * @module
 */
import { Select, SettingsForm, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GroupSettingsFace } from './settings.ts'
import type { GroupCatalogFace } from './catalog.ts'
import css from './Group.module.css'

/**
 * Select models without exposing configuration serialization.
 * @param props - Form state, catalog action, and localized copy.
 * @returns A staged settings form.
 */
export function GroupSettings(props: PropsRuntime<'plugins.bundle.config'> & PropsLocale<'model-group'> & InjectFace<GroupSettingsFace & GroupCatalogFace>) {
  const { t } = props
  const state = props.useGroupSettings(value => value)
  const { value: catalog, status } = props.useGroupCatalog(value => value)
  const loading = status === 'idle' || status === 'loading'
  const failed = status === 'error'
  const disabled = !state.writable || state.saving
  const invalid = state.members.length > 0 && !state.members.some(member => member.name === state.leader.text)
  const unavailable = state.members.filter(member => !catalog?.groups.some(provider =>
    provider.id === member.provider && provider.models.some(model => model.id === member.model)))
  return <SettingsForm state={{ ...state, invalid: state.invalid || invalid }} onSave={props.save} onDiscard={props.discard}
    labels={{ unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }}>
    <div className={css.settings}>
      <label className={css.field}>{t('defaultMode')}<Select disabled={disabled} value={state.defaultMode.text} aria-label={t('defaultMode')}
        options={[{ value: 'multi', label: t('multi') }, { value: 'single', label: t('single') }]}
        onValueChange={(value) => { props.edit('defaultMode', value) }} /></label>
      <label className={css.field}>{t('leader')}<Select disabled={disabled || state.members.length === 0} value={state.leader.text} aria-label={t('leader')}
        options={state.members.map(member => ({ value: member.name, label: member.label }))}
        onValueChange={(value) => { props.edit('leader', value) }} /></label>
      <label className={css.field}>{t('maxParallel')}<input type="number" min={1} step={1} value={state.maxParallel.text} disabled={disabled} onChange={(event) => { props.edit('maxParallel', event.target.value) }} /></label>
      <section aria-label={t('members')}>
        {loading && catalog === null ? <div className={css.loading} role="status" aria-label={t('members')}><StateDot state="ongoing" /></div> : null}
        {failed ? <p role="alert">{t('loadFailed')} <button type="button" onClick={props.refreshCatalog}>{t('retry')}</button></p> : null}
        {catalog?.groups.map(provider => <div key={provider.id}>
          <div className={css.secondary}>{provider.name}</div>
          {provider.models.map((model) => {
            const selected = state.members.find(member => member.provider === provider.id && member.model === model.id)
            return <div key={model.id} className={css.modelOption}>
              <label><input type="checkbox" checked={selected !== undefined} disabled={disabled} onChange={() => {
                const base = model.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'model'
                const alias = /^[a-z]/.test(base) ? base : `model-${base}`
                let name = alias
                let serial = 2
                while (state.members.some(member => member.name === name)) name = `${alias}-${serial++}`
                const label = state.members.some(member => member.label === model.name) ? `${model.name} (${provider.id}/${model.id})` : model.name
                const next = selected === undefined
                  ? [...state.members, { name, label, provider: provider.id, model: model.id, strengths: '' }]
                  : state.members.filter(member => member !== selected)
                props.setMembers(next, next.some(member => member.name === state.leader.text) ? state.leader.text : next[0]?.name ?? '')
              }} />{model.name}</label>
              {selected === undefined ? null : <label className={css.field}>{t('strengths')}<input type="text" value={selected.strengths} disabled={disabled} onChange={(event) => {
                const strengths = event.target.value
                props.setMembers(state.members.map(member => member === selected ? { ...member, strengths } : member), state.leader.text)
              }} /></label>}
            </div>
          })}
        </div>)}
        {catalog?.failures.map(failure => <p role="alert" key={failure.id}>{failure.name}: {failure.message}</p>)}
        {unavailable.map(member => <div className={css.modelOption} key={member.name}>
          <label><input type="checkbox" checked disabled={disabled} onChange={() => {
            const next = state.members.filter(candidate => candidate !== member)
            props.setMembers(next, next.some(candidate => candidate.name === state.leader.text) ? state.leader.text : next[0]?.name ?? '')
          }} />{member.label} · {member.provider}/{member.model}</label>
          <label className={css.field}>{t('strengths')}<input type="text" value={member.strengths} disabled={disabled} onChange={(event) => {
            const strengths = event.target.value
            const next = state.members.map(candidate => candidate === member ? { ...candidate, strengths } : candidate)
            props.setMembers(next, state.leader.text)
          }} /></label>
        </div>)}
      </section>
      {invalid ? <p role="alert" className={css.error}>{t('invalid')}</p> : null}
    </div>
  </SettingsForm>
}
