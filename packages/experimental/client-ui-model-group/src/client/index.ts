/**
 * Model-group plugin settings, conversation controls, public posts, and @ addressing.
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { CommandClaim, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { GroupDelivery, GroupDock, GroupLeaderHeader, GroupMode, GroupPost, type GroupActions } from './GroupControls.tsx'
import { GroupToolRow } from './GroupToolRow.tsx'
import { GroupSettings } from './GroupSettings.tsx'
import { GroupSettingsController, type GroupSettingsValues } from './settings.ts'
import { en, zh, ja, es, fr, de, ru, pt, type GroupKey } from './locales.ts'
import { groupDeliveryDefinition, groupPostDefinition } from './post.ts'
import { resolveModelRecipients } from './mentions.ts'
export type {} from './post.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'model-group': GroupKey }
}

/**
 * Browser services supplied by the Web profile.
 */
export const inject = ['slots', 'locale', 'sessions', 'remote', 'remote.commands', 'remote.session', 'uiConversation', 'uiSession', 'configForms', 'inputTriggers', 'modelDirectories']

/**
 * Register reversible model-group UI contributions.
 * @param ctx - Browser context.
 */
export function apply(ctx: Context): void {
  const namespace = 'model-group'
  ctx.effect(() => ctx.locale.register(namespace, { en, zh, ja, es, fr, de, ru, pt }), 'model-group: locales')
  const t = ctx.locale.bind(namespace)
  const groupOf = (id: SessionId) => ctx.sessions.list.getSnapshot().projectionsBySession[id]?.values.modelGroup
  ctx.effect(() => ctx.modelDirectories.lockSelection({
    locked: (id) => {
      const group = groupOf(id)
      if (group?.mode === 'multi' && group.members.some(member => member.name === group.leader)) return true
      const state = ctx.sessions.list.getSnapshot()
      const parent = state.byId[id]?.parentId
      return parent !== undefined && groupOf(parent)?.mode === 'multi'
        && state.projectionsBySession[parent]?.values.agentTeam?.members.some(member => member.id === id && member.coordinationOwner === 'model-group') === true
    },
    subscribe: listener => ctx.sessions.list.subscribe(listener),
  }), 'model-group: leader model selection')
  const command = async (id: SessionId, line: string): Promise<void> => {
    const result = await ctx.remote.commands.execute(id, `/model-group ${line}`, [])
    if (!result.ok) throw result.error
    if (result.value === undefined || result.value.result.kind !== 'success') throw new Error(result.value?.result.text ?? t('operationFailed'))
  }
  ctx.effect(() => ctx.uiConversation.stops.register({
    id: 'model-group',
    owns: id => groupOf(id)?.mode === 'multi',
    active: id => ctx.sessions.list.getSnapshot().projectionsBySession[id]?.values.agentTeam?.members.some(member =>
      member.coordinationOwner === 'model-group' && ctx.uiSession.sessionStatus.getSnapshot().get(member.id)?.running === true) === true,
    subscribe: (listener) => {
      const offList = ctx.sessions.list.subscribe(listener)
      const offStatus = ctx.uiSession.sessionStatus.subscribe(listener)
      return () => { offStatus(); offList() }
    },
    stop: id => command(id, 'stop'),
  }), 'model-group: composer stop')
  const claim = (id: SessionId, name: string, additional: readonly string[] = []): CommandClaim => ({
    name: 'model-group', token: `@${name} `, hint: t('mention'), attachments: true, wholeMessage: true,
    submit: async (text, _actx, attachments) => {
      const group = groupOf(id)
      if (group?.mode !== 'multi') return { kind: 'error', text: t('operationFailed') }
      const selected = [name, ...additional]
      const result = await ctx.remote.commands.execute(id, `/model-group tell ${selected.join(',')} ${text}`, attachments)
      if (!result.ok) return { kind: 'error', text: result.error.message }
      return result.value?.result ?? { kind: 'error', text: t('operationFailed') }
    },
  })
  const source: InputTriggerSource = {
    trigger: '@', name: 'models', order: -10,
    claimsMessage: (session, line) => {
      const group = groupOf(session.sessionId)
      return !line.trimStart().startsWith('/') && group?.mode === 'multi' && resolveModelRecipients(line, group.members).length > 0
    },
    candidates: (session) => {
      const group = groupOf(session.sessionId)
      if (group?.mode !== 'multi') return Promise.resolve([])
      return Promise.resolve(group.members.map(member => ({ name: member.name, label: member.label, description: member.strengths, section: t('messageModels'), icon: 'session' as const })))
    },
    onPick: pick => ({ text: `@${pick.candidate.name} ` }),
    lexicon: session => groupOf(session.sessionId)?.mode === 'multi' ? groupOf(session.sessionId)?.members.map(member => member.name) : [],
    subscribeLexicon: (session, listener) => {
      let mode = groupOf(session.sessionId)?.mode
      let models = groupOf(session.sessionId)?.members
      return ctx.sessions.list.subscribe(() => {
        const next = groupOf(session.sessionId)
        if (next?.mode === mode && next?.members === models) return
        mode = next?.mode; models = next?.members
        listener()
      })
    },
    matchClaim: (session, token) => {
      const name = token.replace(/^@/, '').trim()
      const known = groupOf(session.sessionId)?.members.some(member => member.name === name)
      return Promise.resolve(known ? claim(session.sessionId, name) : undefined)
    },
    matchEnter: (session, line, _signal, envelope) => {
      const group = groupOf(session.sessionId)
      const [name, ...additional] = group?.mode === 'multi' && !line.trimStart().startsWith('/')
        ? resolveModelRecipients(envelope.routingText ?? line, group.members) : []
      return Promise.resolve(name === undefined ? undefined : { claim: claim(session.sessionId, name, additional) })
    },
  }
  ctx.effect(() => ctx.inputTriggers.registerSource(source), 'model-group: @ models')
  ctx.effect(() => ctx.uiConversation.events.register(groupPostDefinition), 'model-group: public messages')
  ctx.effect(() => ctx.uiConversation.events.register(groupDeliveryDefinition), 'model-group: delivery acknowledgements')
  const actions = (id: SessionId): GroupActions => ({
    command: line => command(id, line),
  })
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: 'model-group-mode', locale: namespace, inject: actions }, GroupMode))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'model-group', order: 30, locale: namespace, inject: actions }, GroupDock))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: 'model-group-post', locale: namespace }, GroupPost))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: 'model-group-delivery', locale: namespace }, GroupDelivery))
  ctx.slots.inject('conversation.chat.assistant.header', () => ctx.slots.register({ name: 'conversation.chat.assistant.header', id: 'model-group-speaker', locale: namespace }, GroupLeaderHeader))
  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'model_group_assign', locale: namespace }, GroupToolRow)
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'model_group_tasks', locale: namespace }, GroupToolRow)
  })
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({ name: 'conversation.chat.commandview', key: 'model-group' }, () => null))
  const settings = new GroupSettingsController(ctx.configForms.get<GroupSettingsValues>('model-group'))
  const settingsFace = settings.inject()
  const catalogFace = {
    hooks: { groupCatalog: ctx.modelDirectories.catalogSource() },
    refreshCatalog: () => { ctx.modelDirectories.refreshCatalog() },
  }
  ctx.effect(() => () => { settings.dispose() }, 'model-group: settings')
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: '@deepseek-ai/dsh-experimental-model-group', locale: namespace,
    inject: () => ({ ...settingsFace, ...catalogFace, hooks: { ...settingsFace.hooks, ...catalogFace.hooks } }),
  }, GroupSettings))
}
