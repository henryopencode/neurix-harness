/** Source-safe Agent Teams browser registration. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { TeamAction, type TeamActionInjected } from './TeamAction.tsx'
import { TeamView, type TeamViewInjected } from './TeamView.tsx'
import { createTeamFeed, type TeamFeed } from './team-feed.ts'
import { en, ja, es, fr, de, ru, pt, NS, zh, type TeamKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent Teams roster and task-board copy. */
    'agent-team': TeamKey
  }
}

/** Required browser services for navigation, slots, and localized copy. */
export const inject = ['sessions', 'uiWorkspace', 'uiConversation', 'slots', 'locale']

/**
 * Register the Team dictionaries, header action, and chat-room View.
 * The panel reads the Lead Session's `agentTeam` projection from the shared
 * Session store; this registration performs no Team RPC.
 * @param ctx - Client Context carrying the injected navigation, locale, slot, and Session services.
 */
export function registerAgentTeamUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'client-ui-agent-team: dictionaries')
  const sessions = ctx.sessions
  const feeds = new WeakMap<SessionBinding, TeamFeed>()
  const activeFeeds = new Set<TeamFeed>()
  ctx.effect(() => () => {
    for (const feed of activeFeeds) feed.dispose()
  }, 'client-ui-agent-team: transcript references')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'team', order: 20, locale: NS,
    label: () => t('view.title'),
    inject: (sessionId): TeamViewInjected => {
      const binding = sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`team view: Session ${sessionId} is unavailable`)
      let feed = feeds.get(binding)
      if (feed === undefined) {
        feed = createTeamFeed(sessions, source => ctx.uiConversation.binding(source).target('chat'), sessionId, activeFeeds)
        feeds.set(binding, feed)
      }
      return {
        hooks: { teamFeed: feed }, loadOlder: () => feed.loadOlder(),
        loadImage: (id, attachment) => ctx.uiConversation.imageUrl(id, attachment),
        peekImage: (id, attachment) => ctx.uiConversation.peekImageUrl(id, attachment),
      }
    },
  }, TeamView))
  const leadSessionId = (sessionId: SessionId): SessionId => {
    const address = sessions.binding(sessionId)?.session.getSnapshot().subagent?.address
    return address?.parentSessionId ?? sessionId
  }

  const actions: TeamActionInjected = {
    openTeammate(sessionId: SessionId, childSessionId: SessionId): void {
      const parentSessionId = leadSessionId(sessionId)
      if ((sessions.retainInfo(sessionId).getSnapshot().retainedBy.mainView ?? 0) === 0) return
      if (childSessionId === parentSessionId) {
        ctx.uiWorkspace.openSession(parentSessionId)
        return
      }
      ctx.uiWorkspace.openSession({
        parentSessionId,
        childSessionId,
        mode: 'continuable',
      })
    },
  }

  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'agent-team',
      order: -20,
      locale: NS,
      inject: () => actions,
    }, TeamAction),
  )
}
