// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { EMPTY_CHAT_SNAPSHOT, type ChatConversationViewNode, type ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TeamMemberProjection } from '@deepseek-ai/dsh-experimental-agent-team/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TeamView, type TeamViewProps } from '../src/client/TeamView.tsx'
import type { TeamFeedSnapshot } from '../src/client/team-feed.ts'
import { teamMessages } from '../src/client/team-messages.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const LEAD = 'lead' as SessionId
const lead: TeamMemberProjection = { id: LEAD, name: 'lead', role: 'lead', phase: 'active' }
const session: SessionSnapshot = { sessionId: LEAD, pendingSubmissions: [], running: true,
  subagent: null, removed: false, openState: 'open', openError: null, hasMore: false, loadingOlder: false,
  promptError: null, blank: false, lastAgentError: null, promptAttempted: false, awaitingFirstTurn: false }

function response(blocks: readonly unknown[], status: string): ChatSnapshot {
  const node: ChatConversationViewNode = { key: 'assistant-step', id: '1:1', target: 'chat', kind: 'assistant-step',
    visibility: 'visible', anchorSeq: 4, location: { kind: 'session' },
    data: { status, turn: 1, step: 1, time: 1000, blocks } }
  return { ...EMPTY_CHAT_SNAPSHOT, nodes: { ...EMPTY_CHAT_SNAPSHOT.nodes, values: () => [node] } }
}

function bench(chat: ChatSnapshot) {
  const source = createSnapshotStore<TeamFeedSnapshot>({ members: [lead],
    messages: teamMessages(lead, chat, session, [lead]), loading: false, hasMore: false, loadingOlder: false, failures: [] })
  const props = {
    useTeamFeed: bindSnapshotSelector(source), loadOlder: vi.fn(async () => {}),
    loadImage: vi.fn(async () => ''), peekImage: vi.fn(() => undefined), renderFactorySlot: vi.fn(() => null),
    t: makeTranslate(zh),
  } as TeamViewProps
  return { source, props, ...render(<TeamView {...props} />) }
}

describe('Team View replies', () => {
  it('shows thinking activity without reasoning text, then streams the reply in the same message', () => {
    const b = bench(response([{ kind: 'reasoning', text: 'Internal reasoning' }], 'running'))
    expect(screen.getByText('思考中…')).toBeDefined()
    expect(screen.queryByText('Internal reasoning')).toBeNull()
    const row = b.container.querySelector('[data-team-message]')
    act(() =>{  b.source.set({ ...b.source.getSnapshot(),
      messages: teamMessages(lead, response([{ kind: 'reasoning', text: 'Internal reasoning' }, { kind: 'text', text: '正在' }], 'running'), session, [lead]),
    }) })
    expect(screen.queryByText('思考中…')).toBeNull()
    expect(screen.getByText('正在')).toBeDefined()
    expect(b.container.querySelector('[data-team-message]')).toBe(row)
    act(() =>{  b.source.set({ ...b.source.getSnapshot(),
      messages: teamMessages(lead, response([{ kind: 'text', text: '正在整理结果。' }], 'settled'), { ...session, running: false }, [lead]),
    }) })
    expect(screen.getByText('正在整理结果。')).toBeDefined()
    expect(b.container.querySelectorAll('[data-team-message]')).toHaveLength(1)
  })

  it('removes a thinking-only message when the response settles without visible output', () => {
    const b = bench(response([{ kind: 'reasoning', text: 'Reasoning' }], 'settled'))
    expect(b.container.querySelectorAll('[data-team-message]')).toHaveLength(0)
    expect(screen.queryByText('思考中…')).toBeNull()
  })

  it('renders each root and nested Tool call in a separate attributed message', () => {
    const nested: ToolCallBlock = { phase: 'start', callId: 'nested', name: 'read_file', turn: 1, step: 2,
      time: 2000, argsRaw: '{"path":"src/index.ts"}', args: {} as ToolCallBlock['args'], subCalls: [] }
    const root: ToolCallBlock = { ...nested, callId: 'root', name: 'ptc', subCalls: [nested] }
    const tool: ChatConversationViewNode = { key: 'tool', id: 'root', target: 'chat', kind: 'tool-call',
      visibility: 'visible', anchorSeq: 8, location: { kind: 'session' }, data: { root } }
    const answer = response([{ kind: 'text', text: '先检查代码。' }], 'settled')
    const b = bench({ ...answer, nodes: { ...answer.nodes, values: () => [...answer.nodes.values(), tool] } })
    expect(b.container.querySelectorAll('[data-team-message]')).toHaveLength(3)
    expect(b.container.querySelectorAll('[data-kind="tool"]')).toHaveLength(2)
    for (const row of b.container.querySelectorAll('[data-kind="tool"]')) {
      expect(row.querySelectorAll('[data-tool-call]')).toHaveLength(1)
      expect(row.textContent).toContain('lead')
    }
  })

  it('keeps unreadable member failures visible alongside existing replies', () => {
    const b = bench(response([{ kind: 'text', text: '已完成的回复' }], 'settled'))
    act(() =>{  b.source.set({ ...b.source.getSnapshot(), failures: [{ id: 'reviewer', name: 'reviewer', message: 'Connection lost' }] }) })
    expect(screen.getByText('已完成的回复')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('reviewer')
    expect(screen.getByRole('alert').textContent).toContain('切换视角重试')
  })
})
