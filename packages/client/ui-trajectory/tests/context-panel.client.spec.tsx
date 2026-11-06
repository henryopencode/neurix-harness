// @vitest-environment jsdom
/** User-visible context diagnostics and recovery through the shared modal. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { SessionProjectionMap, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ContextDiagnosticsPanel } from '../src/client/ContextDiagnosticsPanel.tsx'
import type { TrajectorySnapshot } from '../src/client/trajectory-contract.ts'
import { EMPTY_TRAJECTORY_SNAPSHOT } from '../src/client/trajectory-snapshot-builder.ts'
import { t } from './locale.client.ts'

afterEach(cleanup)

function projectionReader(values: Partial<SessionProjectionMap>) {
  function read<K extends keyof SessionProjectionMap>(key: K): SessionProjectionMap[K] | undefined
  function read<K extends keyof SessionProjectionMap, S>(key: K, selector: (value: SessionProjectionMap[K] | undefined) => S): S
  function read<K extends keyof SessionProjectionMap, S>(key: K, selector?: (value: SessionProjectionMap[K] | undefined) => S) {
    return selector === undefined ? values[key] : selector(values[key])
  }
  return read
}

function props(overrides: Partial<ComponentProps<typeof ContextDiagnosticsPanel>> = {}): ComponentProps<typeof ContextDiagnosticsPanel> {
  const projections: Partial<SessionProjectionMap> = {
    contextPressure: { projectedTokens: 2_000, contextWindow: 10_000 },
    contextBreakdown: { systemTokens: 100, toolsTokens: 200, messageTokens: 300 },
  }
  const session: SessionSnapshot = {
    sessionId: 'context-test' as SessionId, pendingSubmissions: [], running: false, subagent: null,
    removed: false, openState: 'open', openError: null, hasMore: true, loadingOlder: false,
    promptError: null, blank: false, lastAgentError: null, promptAttempted: true, awaitingFirstTurn: false,
  }
  const trajectory: TrajectorySnapshot = {
    ...EMPTY_TRAJECTORY_SNAPSHOT,
    requests: [1, 2].map(step => ({
      purpose: 'assistant', startSeq: step, turn: 1, step, startedAt: step, completedAt: step + 1,
      status: 'complete', usage: { inputTokens: step * 100, cacheReadTokens: 100, outputTokens: 5 },
      prompt: { system: '', config: { provider: 'a', model: 'model-a' },
        tools: [{ name: `tool_${step}`, description: '', parameters: { type: 'object' } }] },
      requestConfig: { provider: 'a', model: 'model-a' },
    })),
  }
  return {
    useProjection: projectionReader(projections),
    useSession: selector => selector(session),
    useTrajectory: selector => selector(trajectory),
    onClose: vi.fn(), loadOlder: vi.fn(async () => true), t,
    ...overrides,
  }
}

describe('context diagnostics panel', () => {
  it('separates estimated composition from reported usage and changes the selected tool catalog', () => {
    render(<ContextDiagnosticsPanel {...props()} />)
    const dialog = screen.getByRole('dialog', { name: 'Context diagnostics' })
    expect(within(dialog).getByText('~2,000')).toBeTruthy()
    expect(within(dialog).getByText('20%')).toBeTruthy()
    expect(within(dialog).getByText('+100')).toBeTruthy()
    expect(within(dialog).getByText('tool_2')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Turn 1 · Step 1' }))
    expect(within(dialog).getByText('tool_1')).toBeTruthy()
    expect(within(dialog).queryByText('tool_2')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Turn 1 · Step 1' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps loaded diagnostics after a paging failure and permits retry', async () => {
    const loadOlder = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(true)
    render(<ContextDiagnosticsPanel {...props({ loadOlder })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Load earlier history' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain("Couldn't load earlier requests") })
    expect(screen.getByText('tool_2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Load earlier history' }))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
    expect(loadOlder).toHaveBeenCalledTimes(2)
  })

  it('presents absent projections and empty history without invented zeros', () => {
    render(<ContextDiagnosticsPanel {...props({
      useProjection: projectionReader({}),
      useTrajectory: selector => selector(EMPTY_TRAJECTORY_SNAPSHOT),
    })} />)
    expect(screen.getByText('Not reported')).toBeTruthy()
    expect(screen.getByText('Send a message to inspect request usage')).toBeTruthy()
    expect(screen.queryByText('0%')).toBeNull()
  })

  it('uses the shared close control', () => {
    const onClose = vi.fn()
    render(<ContextDiagnosticsPanel {...props({ onClose })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
