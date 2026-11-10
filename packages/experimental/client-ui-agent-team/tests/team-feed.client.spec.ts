import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { TestSessions } from '@deepseek-ai/dsh-client-test-runtime'
import { EMPTY_CHAT_SNAPSHOT, type ChatConversationViewNode, type ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { TeamMemberProjection } from '@deepseek-ai/dsh-experimental-agent-team/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createTeamFeed, type TeamFeed } from '../src/client/team-feed.ts'

const LEAD = 'lead-id' as SessionId
const CHILD = 'reviewer-id' as SessionId
const lead: TeamMemberProjection = { id: LEAD, name: 'lead', role: 'lead', phase: 'active' }
const child: TeamMemberProjection = { id: CHILD, name: 'reviewer', role: 'teammate', phase: 'active' }
const disposals: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of disposals.splice(0)) await dispose() })

function sessionState(id: SessionId): SessionSnapshot {
  return { sessionId: id, pendingSubmissions: [], running: false, subagent: null, removed: false,
    openState: 'open', openError: null, hasMore: false, loadingOlder: false, promptError: null,
    blank: false, lastAgentError: null, promptAttempted: false, awaitingFirstTurn: false }
}

function chatReply(text: string, time: number): ChatSnapshot {
  const node: ChatConversationViewNode = {
    key: 'answer', id: 'answer', target: 'chat', kind: 'assistant-step', visibility: 'visible', anchorSeq: 5,
    location: { kind: 'session' },
    data: { status: 'settled', turn: 1, step: 1, time, blocks: [{ kind: 'text', text }] },
  }
  return { ...EMPTY_CHAT_SNAPSHOT, order: [node.key], nodes: { ...EMPTY_CHAT_SNAPSHOT.nodes, values: () => [node] } }
}

async function bench(options: { childSelected?: boolean; failChild?: boolean; failTarget?: boolean } = {}) {
  const selected = options.childSelected ? CHILD : LEAD
  const ctx = new Context()
  const sessions = new TestSessions(async (action) => { await action() }, ctx)
  const loadLead = vi.fn(async () => {})
  const loadChild = vi.fn(async () => {})
  await sessions.add({ id: LEAD, snapshot: sessionState(LEAD), session: { loadOlder: loadLead } })
  await sessions.add({ id: CHILD, snapshot: { ...sessionState(CHILD), subagent: {
    address: { parentSessionId: LEAD, childSessionId: CHILD, mode: 'continuable' },
  } }, session: { loadOlder: loadChild } })
  const visible = sessions.retain(selected, { source: 'testView' })
  await visible.ready
  const chats = new Map([
    [LEAD, createSnapshotStore<ChatSnapshot | undefined>(chatReply('Lead response', 20))],
    [CHILD, createSnapshotStore<ChatSnapshot | undefined>(chatReply('Review response', 10))],
  ])
  const list = sessions.list
  list.set({ ...list.getSnapshot(),
    projectionsBySession: { [LEAD]: { state: 'ready', error: null, values: { agentTeam: { members: [lead, child], tasks: [] } } } },
  })
  const releases: SessionId[] = []
  const originalRetain = sessions.retain.bind(sessions)
  const retain = vi.spyOn(sessions, 'retain').mockImplementation((target, retainOptions) => {
    const id = typeof target === 'string' ? target : target.childSessionId
    if (options.failChild && id === CHILD) throw new Error('Child history unavailable')
    const reference = originalRetain(target, retainOptions)
    const release = (): void => { releases.push(id); reference.release() }
    return { sessionId: id, binding: reference.binding, ready: reference.ready, release, [Symbol.dispose]: release }
  })
  const active = new Set<TeamFeed>()
  const feed = createTeamFeed(sessions, (binding) => {
    if (options.failTarget && binding.sessionId === CHILD) throw new Error('Chat target unavailable')
    return chats.get(binding.sessionId)!
  }, selected, active)
  disposals.push(async () => { feed.dispose(); visible.release(); await ctx.fiber.dispose() })
  return { feed, active, list, retain, releases, chats, sessions, loadLead, loadChild }
}

describe('Team transcript ownership', () => {
  it('retains nothing until visible, shares subscriptions, and releases every member on the final unsubscribe', async () => {
    const b = await bench()
    expect(b.retain).not.toHaveBeenCalled()
    const stopFirst = b.feed.subscribe(vi.fn())
    const stopSecond = b.feed.subscribe(vi.fn())
    expect(b.retain).toHaveBeenCalledTimes(2)
    expect(b.retain.mock.calls[1]?.[0]).toEqual({ parentSessionId: LEAD, childSessionId: CHILD, mode: 'continuable' })
    expect(b.feed.getSnapshot().messages.map(row => row.senderId)).toEqual([CHILD, LEAD])
    stopFirst()
    expect(b.releases).toEqual([])
    stopSecond()
    expect(b.releases).toEqual([LEAD, CHILD])
    expect(b.active.size).toBe(0)
    const snapshot = b.feed.getSnapshot()
    b.chats.get(CHILD)!.set(chatReply('Unobserved update', 30))
    expect(b.feed.getSnapshot()).toBe(snapshot)
  })

  it('observes the Lead roster when opened from a teammate and merges live replies chronologically', async () => {
    const b = await bench({ childSelected: true })
    const stop = b.feed.subscribe(vi.fn())
    expect(b.feed.getSnapshot().members).toEqual([lead, child])
    b.chats.get(CHILD)!.set(chatReply('Later review response', 30))
    expect(b.feed.getSnapshot().messages.map(row => row.senderId)).toEqual([LEAD, CHILD])
    stop()
  })

  it('releases removed members and loads older history only for members with more pages', async () => {
    const b = await bench()
    const stop = b.feed.subscribe(vi.fn())
    await b.sessions.updateSessionSnapshot(LEAD, (snapshot) => { snapshot.hasMore = true })
    await b.feed.loadOlder()
    expect(b.loadLead).toHaveBeenCalledOnce()
    expect(b.loadChild).not.toHaveBeenCalled()
    b.list.set({ ...b.list.getSnapshot(), projectionsBySession: {
      [LEAD]: { state: 'ready', error: null, values: { agentTeam: { members: [lead], tasks: [] } } },
    } })
    expect(b.releases).toEqual([CHILD])
    expect(b.feed.getSnapshot().messages.map(row => row.senderId)).toEqual([LEAD])
    stop()
  })

  it.each([{ failChild: true }, { failTarget: true }])('keeps readable messages and reports member acquisition failures: %j', async (options) => {
    const b = await bench(options)
    const stop = b.feed.subscribe(vi.fn())
    expect(b.feed.getSnapshot().messages).toHaveLength(1)
    expect(b.feed.getSnapshot().failures[0]).toMatchObject({ id: CHILD, name: 'reviewer' })
    expect(b.releases).toEqual(options.failTarget ? [CHILD] : [])
    stop()
  })

  it('releases references on plugin disposal and ignores later publications', async () => {
    const b = await bench()
    const stop = b.feed.subscribe(vi.fn())
    b.feed.dispose()
    const snapshot = b.feed.getSnapshot()
    b.list.set({ ...b.list.getSnapshot(), phase: 'pending' })
    expect(b.releases).toEqual([LEAD, CHILD])
    expect(b.feed.getSnapshot()).toBe(snapshot)
    stop()
    expect(b.releases).toHaveLength(2)
  })
})
