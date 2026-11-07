/** Model-aware Team settings and conversation contributions, owned by the Team UI plugin. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-commands/remote'
import type { CommandClaim, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { TeamSettingsController, type TeamSettingsValues } from './settings.ts'
import { TeamSettings } from './TeamSettings.tsx'
import { TeamLeader, TeamPost, teamPostDefinition } from './TeamConversation.tsx'
import { modelEn, modelZh, modelJa, modelEs, modelFr, modelDe, modelRu, modelPt, type ModelKey } from './model-locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'team-models': ModelKey }
}

/**
 * Install model-aware features once the existing browser services become available.
 * @param ctx - Team UI owner context.
 */
export function registerTeamModels(ctx: Context): void {
  ctx.inject(['modelDirectories', 'configForms', 'uiConversation', 'inputTriggers', 'remote.commands', 'uiSession'], (scope) => {
    scope.effect(() => scope.locale.register('team-models', {
      en: modelEn, zh: modelZh, ja: modelJa, es: modelEs, fr: modelFr, de: modelDe, ru: modelRu, pt: modelPt,
    }), 'team: model copy')
    const selection = (id: SessionId) => scope.sessions.list.getSnapshot().projectionsBySession[id]?.values.teamModels
    const members = (id: SessionId) => scope.sessions.list.getSnapshot().projectionsBySession[id]?.values.agentTeam?.members ?? []
    const candidates = (id: SessionId) => {
      const models = selection(id)?.models ?? []
      const actual = members(id).map(member => ({ name: member.name, label: member.name, strengths: '' }))
      return [...actual, ...models.filter(model => !actual.some(member => member.name === model.name))]
    }
    const recipients = (id: SessionId, text: string): string[] => {
      const known = new Set(candidates(id).map(member => member.name))
      const searchable = text.replace(/```[\s\S]*?(?:```|$)|`[^`\n]*`/gu, token => ' '.repeat(token.length))
      const matches = searchable.matchAll(/(?<![a-zA-Z0-9_])@([a-z][a-z0-9-]*)(?![a-zA-Z0-9_./-])/gu)
      return [...new Set([...matches].flatMap(match => match[1] !== undefined && known.has(match[1]) ? [match[1]] : []))]
    }
    const t = scope.locale.bind('team-models')
    const command = async (id: SessionId, line: string): Promise<void> => {
      const result = await scope.remote.commands.execute(id, `/team ${line}`, [])
      if (!result.ok) throw result.error
      if (result.value?.result.kind !== 'success') throw new Error(result.value?.result.text ?? t('operationFailed'))
    }
    const claim = (id: SessionId, names: readonly string[]): CommandClaim => ({
      name: 'team', token: `@${names[0]} `, hint: t('messageTeam'), attachments: true, wholeMessage: true,
      submit: async (text, _actx, attachments) => {
        const result = await scope.remote.commands.execute(id, `/team tell ${names.join(',')} ${text}`, attachments)
        return result.ok ? result.value?.result ?? { kind: 'error', text: t('operationFailed') } : { kind: 'error', text: result.error.message }
      },
    })
    const source: InputTriggerSource = {
      trigger: '@', name: 'team', order: -10,
      claimsMessage: (session, text) => !text.trimStart().startsWith('/') && recipients(session.sessionId, text).length > 0,
      candidates: session => Promise.resolve(candidates(session.sessionId).map(member => ({ name: member.name, label: member.label,
        description: member.strengths, section: t('messageTeam'), icon: 'session' as const }))),
      onPick: pick => ({ text: `@${pick.candidate.name} ` }),
      lexicon: session => candidates(session.sessionId).map(member => member.name),
      subscribeLexicon: (_session, listener) => scope.sessions.list.subscribe(listener),
      matchClaim: (session, token) => {
        const name = token.replace(/^@/, '').trim()
        const known = candidates(session.sessionId).some(member => member.name === name)
        return Promise.resolve(known ? claim(session.sessionId, [name]) : undefined)
      },
      matchEnter: (session, text, _signal, envelope) => {
        const names = text.trimStart().startsWith('/') ? [] : recipients(session.sessionId, envelope.routingText ?? text)
        return Promise.resolve(names.length === 0 ? undefined : { claim: claim(session.sessionId, names) })
      },
    }
    scope.effect(() => scope.inputTriggers.registerSource(source), 'team: direct addressing')
    scope.effect(() => scope.uiConversation.events.register(teamPostDefinition), 'team: public replies')
    scope.effect(() => scope.uiConversation.stops.register({
      id: 'agent-team', owns: id => members(id).length > 1 || selection(id) !== undefined && selection(id) !== null,
      active: id => members(id).some(member => member.role !== 'lead' && scope.uiSession.sessionStatus.getSnapshot().get(member.id)?.running === true),
      subscribe: (listener) => {
        const a = scope.sessions.list.subscribe(listener)
        const b = scope.uiSession.sessionStatus.subscribe(listener)
        return () => { b(); a() }
      },
      stop: id => command(id, 'stop'),
    }), 'team: composer stop')
    scope.slots.inject('conversation.chat.node', () => scope.slots.register({ name: 'conversation.chat.node', key: 'team-post', locale: 'team-models' }, TeamPost))
    scope.slots.inject('conversation.chat.assistant.header', () => scope.slots.register({ name: 'conversation.chat.assistant.header', id: 'agent-team', locale: 'team-models' }, TeamLeader))
    const settings = new TeamSettingsController(scope.configForms.get<TeamSettingsValues>('agent-team'))
    scope.effect(() => () => { settings.dispose() }, 'team: settings')
    const face = settings.inject()
    scope.slots.inject('plugins.bundle.config', () => scope.slots.register({
      name: 'plugins.bundle.config', key: '@deepseek-ai/dsh-experimental-agent-team-profile', locale: 'team-models',
      inject: () => ({ ...face, refreshCatalog: () => { scope.modelDirectories.refreshCatalog() },
        hooks: { ...face.hooks, teamCatalog: scope.modelDirectories.catalogSource() } }),
    }, TeamSettings))
  })
}
