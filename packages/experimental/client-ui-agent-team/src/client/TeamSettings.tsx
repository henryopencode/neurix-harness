/**
 * Model catalog selection and editable defaults inside plugin details.
 * @module
 */
import { SettingsForm, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TeamSettingsFace } from './settings.ts'
import type { TeamCatalogFace } from './model-props.ts'
import css from './TeamModels.module.css'

/**
 * Select models without exposing configuration serialization.
 * @param props - Form state, catalog action, and localized copy.
 * @returns A staged settings form.
 */
export function TeamSettings(props: Pick<PropsRuntime<'plugins.bundle.config'>, 'view'> & PropsLocale<'team-models'> & InjectFace<TeamSettingsFace & TeamCatalogFace>) {
  const { t } = props
  const state = props.useTeamSettings(value => value)
  const { value: catalog, status } = props.useTeamCatalog(value => value)
  const loading = status === 'idle' || status === 'loading'
  const failed = status === 'error'
  const disabled = !state.writable || state.saving
  const invalid = state.models.length > 0 && !state.models.some(member => member.name === state.leaderModel.text)
  const unavailable = state.models.filter(member => !catalog?.groups.some(provider =>
    provider.id === member.provider && provider.models.some(model => model.id === member.model)))
  return <SettingsForm state={{ ...state, invalid: state.invalid || invalid }} onSave={props.save} onDiscard={props.discard}
    labels={{ unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }}>
    <div className={css.settings}>
      <label className={css.field}>{t('leaderModel')}<select disabled={disabled || state.models.length === 0} value={state.leaderModel.text} onChange={(event) => { props.edit('leaderModel', event.target.value) }}>{state.models.map(member => <option key={member.name} value={member.name}>{member.label}</option>)}</select></label>
      <label className={css.field}>{t('maxParallel')}<input type="number" min={1} step={1} value={state.maxParallel.text} disabled={disabled} onChange={(event) => { props.edit('maxParallel', event.target.value) }} /></label>
      <section aria-label={t('models')}>
        {loading && catalog === null ? <div className={css.loading} role="status" aria-label={t('models')}><StateDot state="ongoing" /></div> : null}
        {failed ? <p role="alert">{t('loadFailed')} <button type="button" onClick={props.refreshCatalog}>{t('retry')}</button></p> : null}
        {catalog?.groups.map(provider => <div key={provider.id}>
          <div className={css.secondary}>{provider.name}</div>
          {provider.models.map((model) => {
            const selected = state.models.find(member => member.provider === provider.id && member.model === model.id)
            return <div key={model.id} className={css.modelOption}>
              <label><input type="checkbox" checked={selected !== undefined} disabled={disabled} onChange={() => {
                const base = model.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'model'
                const alias = /^[a-z]/.test(base) ? base : `model-${base}`
                let name = alias
                let serial = 2
                while (state.models.some(member => member.name === name)) name = `${alias}-${serial++}`
                const label = state.models.some(member => member.label === model.name) ? `${model.name} (${provider.id}/${model.id})` : model.name
                const next = selected === undefined
                  ? [...state.models, { name, label, provider: provider.id, model: model.id, strengths: '' }]
                  : state.models.filter(member => member !== selected)
                props.setModels(next, next.some(member => member.name === state.leaderModel.text) ? state.leaderModel.text : next[0]?.name ?? '')
              }} />{model.name}</label>
              {selected === undefined ? null : <label className={css.field}>{t('strengths')}<input type="text" value={selected.strengths} disabled={disabled} onChange={(event) => {
                const strengths = event.target.value
                props.setModels(state.models.map(member => member === selected ? { ...member, strengths } : member), state.leaderModel.text)
              }} /></label>}
            </div>
          })}
        </div>)}
        {catalog?.failures.map(failure => <p role="alert" key={failure.id}>{failure.name}: {failure.message}</p>)}
        {unavailable.map(member => <div className={css.modelOption} key={member.name}>
          <label><input type="checkbox" checked disabled={disabled} onChange={() => {
            const next = state.models.filter(candidate => candidate !== member)
            props.setModels(next, next.some(candidate => candidate.name === state.leaderModel.text) ? state.leaderModel.text : next[0]?.name ?? '')
          }} />{member.label} · {member.provider}/{member.model}</label>
          <label className={css.field}>{t('strengths')}<input type="text" value={member.strengths} disabled={disabled} onChange={(event) => {
            const strengths = event.target.value
            const next = state.models.map(candidate => candidate === member ? { ...candidate, strengths } : candidate)
            props.setModels(next, state.leaderModel.text)
          }} /></label>
        </div>)}
      </section>
      {invalid ? <p role="alert" className={css.error}>{t('invalid')}</p> : null}
    </div>
  </SettingsForm>
}
