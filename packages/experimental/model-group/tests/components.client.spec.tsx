// @vitest-environment jsdom
/** Group-mode, model targeting, and member stops through shared Session hooks. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionListState, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { GroupDock, GroupMode } from '../../client-ui-model-group/src/client/GroupControls.tsx'
import { zh } from '../../client-ui-model-group/src/client/locales.ts'
import type { ModelGroupSnapshot } from '../../client-ui-model-group/src/types.ts'

afterEach(cleanup)
const id = 'group' as SessionId
const group: ModelGroupSnapshot = {
  mode: 'multi', leader: 'a', stopped: false, direct: [], stoppedMembers: [], members: [
    { name: 'a', label: 'Model A', provider: 'mock', model: 'a', strengths: 'Analysis' },
    { name: 'b', label: 'Model B', provider: 'mock', model: 'b', strengths: 'Code' },
  ],
}

function bench() {
  const sessions = createSnapshotStore<SessionListState>({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {
    [id]: { state: 'ready', error: null, values: { modelGroup: group, agentTeam: { members: [], tasks: [] } } },
  } })
  const session = createSnapshotStore<SessionSnapshot>({
    sessionId: id, running: false, subagent: null, pendingSubmissions: [], removed: false,
    openState: 'open', openError: null, hasMore: false, loadingOlder: false, promptError: null, blank: true, lastAgentError: null,
    promptAttempted: false, awaitingFirstTurn: false })
  const statuses = createSnapshotStore<SessionStatusSnapshot>(new Map())
  const command = vi.fn().mockResolvedValue(undefined)
  const insertText = vi.fn()
  const props = {
    sessionId: id, useSessions: bindSnapshotSelector(sessions), useSession: bindSnapshotSelector(session),
    useSessionStatus: bindSnapshotSelector(statuses), t: makeTranslate(zh), command,
    inputActions: { insertText, captureInsertion: () => ({ start: 0, end: 0, draftRev: 0 }) },
  }
  return { props, command, insertText, session, sessions, statuses }
}

describe('model-group controls', () => {
  it('changes this conversation’s mode without editing plugin defaults', async () => {
    const { props, command } = bench()
    render(<GroupMode {...props} />)
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: zh.mode }).value).toBe('multi')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'single' } })
    await waitFor(() => { expect(command).toHaveBeenCalledWith('single') })
  })

  it('keeps configured models visible and inserts the selected member’s exact mention', () => {
    const { props, insertText } = bench()
    render(<GroupDock {...props} />)
    expect(screen.getByText('Model A')).toBeTruthy()
    expect(screen.getByText(zh.leader)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `${zh.mention}: Model B` }))
    expect(insertText).toHaveBeenCalledWith('@b ', { start: 0, end: 0, draftRev: 0 })
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(screen.queryByText(zh.idle)).toBeNull()
    expect(screen.queryByText(zh.multi)).toBeNull()
  })

  it('leaves the round stop to the composer while the leader is running', () => {
    const { props, session } = bench()
    session.set({ ...session.getSnapshot(), running: true })
    render(<GroupDock {...props} />)
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(screen.getByText(zh.running)).toBeTruthy()
  })

  it('keeps an accessible member stop icon while only a worker is running', async () => {
    const { props, command, sessions, statuses } = bench()
    const workerId = 'worker-b' as SessionId
    sessions.set({ ...sessions.getSnapshot(), projectionsBySession: {
      [id]: { state: 'ready', error: null, values: { modelGroup: group, agentTeam: {
        members: [{ id: workerId, name: 'b', role: 'teammate', phase: 'active', coordinationOwner: 'model-group' }], tasks: [],
      } } },
    } })
    statuses.set(new Map([[workerId, { running: true, pendingInteraction: undefined, completionUnread: false }]]))
    render(<GroupDock {...props} />)
    const stop = screen.getByRole<HTMLButtonElement>('button', { name: `${zh.stopMember}: Model B` })
    expect(stop.disabled).toBe(false)
    expect(stop.textContent).toBe('')
    expect(stop.querySelector('svg')).not.toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(3)
    fireEvent.click(stop)
    await waitFor(() => { expect(command).toHaveBeenCalledWith('stop b') })
  })
})
