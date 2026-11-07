// @vitest-environment jsdom
/** Model identity, task summaries, and failures in the public group conversation. */
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatNode, ToolResultNode, UseDisclosure } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { GroupPostView } from '../src/client/post.ts'
import type {} from '../src/client/index.ts'
import { SessionSeq, type SessionId } from '@deepseek-ai/dsh-session/types'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { GroupDelivery, GroupLeaderHeader, GroupPost } from '../src/client/GroupControls.tsx'
import { GroupToolRow } from '../src/client/GroupToolRow.tsx'
import { zh } from '../src/client/locales.ts'
import type { ModelGroupSnapshot } from '../src/types.ts'

afterEach(cleanup)
const sessionId = 'group' as SessionId
const group: ModelGroupSnapshot = {
  mode: 'multi', leader: 'gpt', stopped: false, direct: [], stoppedMembers: [], members: [
    { name: 'gpt', label: 'GPT-6.1 Sol', provider: 'gpt', model: 'gpt-6.1-sol', strengths: '' },
    { name: 'gemini', label: 'Gemini 4 Argon', provider: 'gemini', model: 'gemini-4-argon', strengths: '' },
  ],
}
const t = makeTranslate(zh)

function bench(mode = group.mode) {
  const sessions = createSnapshotStore<SessionListState>({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {
    [sessionId]: { state: 'ready', error: null, values: { modelGroup: { ...group, mode } } },
  } })
  return { sessionId, useSessions: bindSnapshotSelector(sessions), t }
}

const useDisclosure: UseDisclosure = () => {
  const [expanded, setExpanded] = useState(false)
  return { expanded, setExpanded, toggle: () => { setExpanded(value => !value) } }
}

function post(data: Partial<GroupPostView> = {}, memberOutput = true): ChatNode<'model-group-post'> {
  return { key: 'post:1', kind: 'model-group-post', target: 'chat', id: '1', anchorSeq: 1,
    location: { kind: 'session' }, visibility: 'visible', data: {
      member: 'gemini', label: 'Gemini 4 Argon', text: 'This is the model’s actual opinion.',
      sourceSession: 'worker' as SessionId, ...memberOutput ? { sourceSeq: SessionSeq(10) } : {}, ...data,
    } }
}

function result(name: string, args: object, error = false): ToolResultNode {
  const argsRaw = JSON.stringify(args)
  return { kind: 'tool-result', seq: 5, time: 10, callTime: 1, callId: 'call-1', name,
    args: PartialArguments.fromText(argsRaw), call: { name, argsRaw }, subCalls: [],
    isError: error, content: [{ type: 'text', text: error ? 'Error: diagnostic retained for inspection' : '[]' }] }
}

describe('group conversation messages', () => {
  it('renders an acknowledgement independently of the ordinary user-message renderer', () => {
    const data = { requestSeq: SessionSeq(1), publicMessage: true as const,
      accepted: [{ member: 'gemini', sessionId: 'worker' as SessionId, accepted: true as const }], failed: [] }
    const node: ChatNode<'model-group-delivery'> = { key: 'delivery:1', id: '1', kind: 'model-group-delivery',
      target: 'chat', anchorSeq: 1.01, location: { kind: 'session' }, visibility: 'visible', data }
    const view = render(<GroupDelivery {...bench()} node={node} />)
    expect(screen.getByRole('status').textContent).toBe(`${zh.sentTo} Gemini 4 Argon`)
    expect(view.container.querySelector('article')).toBeNull()
    expect(screen.queryByText(zh.completed)).toBeNull()
  })

  it('reports inbox acceptance without claiming the addressed model completed its work', () => {
    const receipt = { requestSeq: SessionSeq(1), accepted: [{ member: 'gemini', sessionId: 'worker' as SessionId, accepted: true as const }], failed: [] }
    render(<GroupPost {...bench()} node={post({ member: 'user', label: 'user', text: '@gemini Think again', delivery: receipt }, false)} />)
    expect(screen.getByRole('status').textContent).toBe(`${zh.sentTo} Gemini 4 Argon`)
    expect(screen.queryByText(zh.completed)).toBeNull()
    expect(screen.getAllByText(zh.user)).toHaveLength(1)
  })

  it('keeps an unconfirmed recipient visible beside the original request', () => {
    const delivery = { requestSeq: SessionSeq(1), accepted: [], failed: ['gemini'] }
    render(<GroupPost {...bench()} node={post({ member: 'user', text: '@gemini Think again', delivery }, false)} />)
    expect(screen.getByRole('alert').textContent).toBe(`${zh.deliveryFailed} Gemini 4 Argon`)
    expect(screen.getByText('@gemini Think again')).toBeTruthy()
  })

  it('shows a full model name for each worker reply and a leader heading in group mode', () => {
    const props = bench()
    const view = render(<><GroupLeaderHeader {...props} /><GroupPost {...bench()} node={post()} /></>)
    expect(screen.getByText('GPT-6.1 Sol')).toBeTruthy()
    expect(screen.getByText(zh.leader)).toBeTruthy()
    expect(view.container.querySelector('article[data-group-member="gemini"]')?.textContent).toContain('Gemini 4 Argon')
    expect(screen.getByText('This is the model’s actual opinion.')).toBeTruthy()
  })

  it('leaves ordinary single-model replies without a group leader heading', () => {
    const view = render(<GroupLeaderHeader {...bench('single')} />)
    expect(view.container.textContent).toBe('')
  })

  it('collapses historical assignment instructions instead of showing them as public speech', () => {
    const view = render(<GroupPost {...bench()} node={post({ member: 'gpt', label: 'GPT-6.1 Sol', text: '@Gemini 4 Argon\n\nInternal task instructions' }, false)} />)
    expect(view.container.querySelector('details')?.open).toBe(false)
    expect(screen.getByText(`${zh.assignment} · GPT-6.1 Sol`)).toBeTruthy()
    expect(view.container.querySelector('article')).toBeNull()
  })

  it('keeps a failed model’s identity and a readable next action visible', () => {
    render(<GroupPost {...bench()} node={post({ text: '', failure: 'error' }, false)} />)
    expect(screen.getByText('Gemini 4 Argon')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(zh.failed)
    expect(screen.queryByText('(error)')).toBeNull()
  })

  it('names task creation and keeps raw instructions behind its disclosure', () => {
    const block = result('model_group_tasks', { action: 'create', subject: 'Claude’s opinion', description: 'Internal instructions' })
    render(<GroupToolRow {...bench()} phase="result" block={block} toolName={block.name} useDisclosure={useDisclosure} />)
    const toggle = screen.getByRole('button', { name: `${zh.taskCreate} · Claude’s opinion` })
    expect(screen.queryByText(JSON.stringify({ action: 'create', subject: 'Claude’s opinion', description: 'Internal instructions' }))).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByText(block.call?.argsRaw ?? '')).toBeTruthy()
    expect(screen.getByText(zh.output)).toBeTruthy()
  })

  it('explains historical leader self-assignment without exposing a raw error as the summary', () => {
    const block = result('model_group_assign', { model: 'gpt', task: 'Own opinion' }, true)
    render(<GroupToolRow {...bench()} phase="result" block={block} toolName={block.name} useDisclosure={useDisclosure} />)
    expect(screen.getByRole('button', { name: `${zh.assignment} · GPT-6.1 Sol` })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(zh.selfAssignment)
    expect(screen.queryByText('Error: diagnostic retained for inspection')).toBeNull()
  })
})
