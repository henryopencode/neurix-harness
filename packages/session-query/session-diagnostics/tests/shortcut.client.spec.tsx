// @vitest-environment jsdom
/** The shortcut and index share structured failure eligibility, including nested command outcomes. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DiagnosticShortcut, type DiagnosticShortcutProps } from '../src/client/Shortcut.tsx'
import { en } from '../src/client/locales.ts'
import type {} from '../src/client/index.ts'

afterEach(cleanup)

function fixture(overrides: Partial<DiagnosticShortcutProps['block']> = {}) {
  const openDiagnostic = vi.fn()
  const bound: Partial<DiagnosticShortcutProps> = {
    sessionId: SessionId('source'), t: makeTranslate(en), openDiagnostic,
    block: { kind: 'tool-result', seq: 9, time: 100, callId: 'call', call: null, callTime: null,
      name: 'bash', args: PartialArguments.EMPTY, content: [], isError: false, subCalls: [], ...overrides },
  }
  const props = bound as DiagnosticShortcutProps
  return { props, openDiagnostic }
}
const shell = { kind: 'foreground', exitCode: 60, signal: null, timedOut: false, aborted: false, timeoutMs: 10_000 }

it('opens the original source reference for a nonzero command that is not a tool exception', () => {
  const { props, openDiagnostic } = fixture({ meta: { shellOutcome: shell } })
  render(<DiagnosticShortcut {...props} />)
  fireEvent.click(screen.getByRole('button', { name: en.shortcut }))
  expect(openDiagnostic).toHaveBeenCalledExactlyOnceWith({ sessionId: 'source', eventSeq: 9 })
})

it('offers the same action for a nested failed tool', () => {
  const { props } = fixture({ parentCallId: 'run_code', isError: true, error: { name: 'ValidationError', code: 'INVALID_ARGS' } })
  render(<DiagnosticShortcut {...props} />)
  expect(screen.getByRole('button', { name: en.shortcut })).toBeTruthy()
})

it.each([
  {},
  { isError: true, error: { name: 'AbortError', code: 'ABORTED' } },
  { meta: { shellOutcome: { ...shell, aborted: true, stopped: 'user' } } },
])('omits success and expected cancellation %#', (outcome) => {
  const { props } = fixture(outcome)
  render(<DiagnosticShortcut {...props} />)
  expect(screen.queryByRole('button')).toBeNull()
})

it.each([8.2, -1])('omits non-event display anchors (%s) even when the placeholder looks failed', (seq) => {
  const { props, openDiagnostic } = fixture({ seq, isError: true, error: { name: 'Interrupted', code: 'interrupted' } })
  render(<DiagnosticShortcut {...props} />)
  expect(screen.queryByRole('button')).toBeNull()
  expect(openDiagnostic).not.toHaveBeenCalled()
})

it('opens a recorded nested nonzero command without requiring a tool exception', () => {
  const { props, openDiagnostic } = fixture({ parentCallId: 'run_code', meta: { shellOutcome: shell } })
  render(<DiagnosticShortcut {...props} />)
  fireEvent.click(screen.getByRole('button', { name: en.shortcut }))
  expect(openDiagnostic).toHaveBeenCalledExactlyOnceWith({ sessionId: 'source', eventSeq: 9 })
})

it('visibly reports navigation withdrawal without claiming it opened the record', () => {
  const { props, openDiagnostic } = fixture({ isError: true })
  openDiagnostic.mockImplementation(() => { throw new Error('settings unloaded') })
  render(<DiagnosticShortcut {...props} />)
  fireEvent.click(screen.getByRole('button', { name: en.shortcut }))
  expect(screen.getByRole('alert').textContent).toBe(en.unavailable)
})
