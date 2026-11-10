/** Subscription-owned Team transcript: shared Session references and existing Conversation targets. */
import type { ISessions, SessionBinding, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { TeamMemberProjection } from '@deepseek-ai/dsh-experimental-agent-team/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { teamMessages, type TeamMessage } from './team-messages.ts'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A visible Team transcript's member history and live updates. */
    teamView: unknown
  }
}

/** Read-only presentation assembled for the selected team's loaded history. */
export interface TeamFeedSnapshot {
  readonly members: readonly TeamMemberProjection[]
  readonly messages: readonly TeamMessage[]
  readonly loading: boolean
  readonly hasMore: boolean
  readonly loadingOlder: boolean
  readonly failures: readonly { readonly id: string; readonly name: string; readonly message: string }[]
}

/** The source owns member references only while at least one View observes it. */
export interface TeamFeed extends ObservableSnapshot<TeamFeedSnapshot> {
  /** @returns completion of one older-history page for each member with more history. */
  loadOlder(): Promise<void>
  /** Release subscriptions and references when the plugin unloads. */
  dispose(): void
}

const EMPTY_FEED: TeamFeedSnapshot = {
  members: [], messages: [], loading: true, hasMore: false, loadingOlder: false, failures: [],
}

/**
 * Observe the roster and retain its member Sessions through the existing addressed transport.
 * @param sessions - Client Session owner.
 * @param chatFor - existing Chat target source for a retained Session binding.
 * @param sessionId - conversation whose Team is displayed; its composer remains the submission target.
 * @param active - plugin-owned lifetime accounting for subscribed sources.
 * @returns a stable, lazy source; the final unsubscribe releases every acquired reference.
 */
export function createTeamFeed(
  sessions: ISessions,
  chatFor: (binding: SessionBinding) => ObservableSnapshot<ChatSnapshot | undefined>,
  sessionId: SessionId,
  active: Set<TeamFeed>,
): TeamFeed {
  const store = createSnapshotStore<TeamFeedSnapshot>(EMPTY_FEED)
  const members = new Map<SessionId, {
    reference: SessionReference
    chat: ObservableSnapshot<ChatSnapshot | undefined>
    stop: () => void
  }>()
  const acquisitionFailures = new Map<SessionId, string>()
  let subscribers = 0
  let stopList: (() => void) | undefined
  let reconciling = false
  let disposed = false

  const refresh = (): void => {
    if (disposed || subscribers === 0 || reconciling) return
    reconciling = true
    try {
      const list = sessions.list.getSnapshot()
      const leadId = sessions.binding(sessionId)?.session.getSnapshot().subagent?.address.parentSessionId ?? sessionId
      const team = list.projectionsBySession[leadId]?.values.agentTeam
      const roster: readonly TeamMemberProjection[] = team?.members
        ?? [{ id: leadId, name: '', role: 'lead', phase: 'active' }]
      const wanted = new Set(roster.filter(member => member.phase === 'active').map(member => member.id))
      for (const [id, entry] of members) {
        if (wanted.has(id)) continue
        members.delete(id)
        entry.stop()
        entry.reference.release()
      }
      for (const id of acquisitionFailures.keys()) if (!wanted.has(id)) acquisitionFailures.delete(id)
      for (const member of roster) {
        if (!wanted.has(member.id) || members.has(member.id) || acquisitionFailures.has(member.id)) continue
        let acquired: SessionReference | undefined
        let stopSession: (() => void) | undefined
        let stopChat: (() => void) | undefined
        try {
          const target = member.id === leadId ? leadId : {
            parentSessionId: leadId, childSessionId: member.id, mode: 'continuable' as const,
          }
          const reference = sessions.retain(target, { source: 'teamView' })
          acquired = reference
          const chat = chatFor(reference.binding)
          stopSession = reference.binding.session.subscribe(refresh)
          stopChat = chat.subscribe(refresh)
          const unsubscribeSession = stopSession
          const unsubscribeChat = stopChat
          members.set(member.id, { reference, chat, stop: () => { unsubscribeChat(); unsubscribeSession() } })
          // Session.open publishes structured failures; acquisition rejection still needs a visible owner.
          void reference.ready.catch((error: unknown) => {
            if (members.get(member.id)?.reference !== reference || disposed) return
            acquisitionFailures.set(member.id, error instanceof Error ? error.message : String(error))
            refresh()
          })
        } catch (error) {
          stopChat?.()
          stopSession?.()
          acquired?.release()
          acquisitionFailures.set(member.id, error instanceof Error ? error.message : String(error))
        }
      }
      const messages: TeamMessage[] = []
      const failures: TeamFeedSnapshot['failures'][number][] = []
      let loading = false
      let hasMore = false
      let loadingOlder = false
      if (team?.failure !== undefined) failures.push({ id: 'team', name: '', message: team.failure })
      for (const member of roster) {
        const reference = members.get(member.id)?.reference
        const error = acquisitionFailures.get(member.id) ?? member.error
        if (error !== undefined) failures.push({ id: member.id, name: member.name, message: error })
        if (reference === undefined) {
          loading ||= member.phase === 'provisioning'
          continue
        }
        const session = reference.binding.session.getSnapshot()
        if (session.openError !== null && error === undefined) {
          failures.push({ id: member.id, name: member.name, message: session.openError.message })
        }
        loading ||= session.openState === 'cold' || session.openState === 'loading'
        hasMore ||= session.hasMore
        loadingOlder ||= session.loadingOlder
        messages.push(...teamMessages(member, members.get(member.id)?.chat.getSnapshot(), session, roster))
      }
      messages.sort((left, right) => left.time - right.time
        || left.sessionId.localeCompare(right.sessionId) || left.seq - right.seq || left.id.localeCompare(right.id))
      store.set({ members: roster, messages, loading, hasMore, loadingOlder, failures })
    } finally {
      reconciling = false
    }
  }
  const stop = (): void => {
    stopList?.()
    stopList = undefined
    const entries = [...members.values()]
    members.clear()
    acquisitionFailures.clear()
    for (const entry of entries) {
      entry.stop()
      entry.reference.release()
    }
    active.delete(feed)
  }
  const feed: TeamFeed = {
    getSnapshot: () => store.getSnapshot(),
    subscribe: (listener) => {
      if (disposed) return () => {}
      const unsubscribe = store.subscribe(listener)
      subscribers++
      if (subscribers === 1) {
        active.add(feed)
        stopList = sessions.list.subscribe(refresh)
        refresh()
      }
      return () => {
        unsubscribe()
        subscribers--
        if (subscribers === 0) stop()
      }
    },
    loadOlder: async () => {
      const histories = [...members.values()].map(({ reference }) => reference.binding.session)
        .filter(session => session.getSnapshot().hasMore)
      await Promise.all(histories.map(session => session.loadOlder()))
    },
    dispose: () => { disposed = true; stop() },
  }
  return feed
}
