// @vitest-environment jsdom
/** Product composition uses one settings shell and withdraws optional card actions with their owner. */
import { expect } from 'vitest'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { createSettingsShellStore } from '../../../client/ui-settings-general/src/client/shell-store.ts'
import type { DiagnosticsInjected } from '../src/client/Page.tsx'
import type { DiagnosticShortcutInjected } from '../src/client/Shortcut.tsx'

const it = createClientTest({ roster: webApp })

it('opens the existing shell and retains only the selected source reference', async ({ start }) => {
  const c = await start()
  const page = c.ctx.slots.entries('settings.section').find(entry => entry.options.id === 'session-diagnostics')!
  expect(page).toBeDefined()
  const action = c.ctx.slots.entries('tool.call.action').find(entry => entry.options.id === 'session-diagnostics')!
  expect(action).toBeDefined()
  const pageValues = page.inject!()
  const injected = {
    hooks: pageValues.hooks as DiagnosticsInjected['hooks'],
    releaseFocus: pageValues.releaseFocus as DiagnosticsInjected['releaseFocus'],
  }
  const openDiagnostic = action.inject!().openDiagnostic as DiagnosticShortcutInjected['openDiagnostic']
  const source = { sessionId: SessionId('source'), eventSeq: SessionSeq(9) }
  openDiagnostic(source)
  expect(injected.hooks.focus.getSnapshot()).toEqual(source)
  const newer = { sessionId: SessionId('newer'), eventSeq: SessionSeq(10) }
  openDiagnostic(newer)
  injected.releaseFocus(source)
  expect(injected.hooks.focus.getSnapshot()).toEqual(newer)
  injected.releaseFocus(newer)
  expect(injected.hooks.focus.getSnapshot()).toBeUndefined()
  const shell = c.ctx.slots.entries('sidebar.settings')[0]!
  const store = shell.store as ReturnType<typeof createSettingsShellStore>
  expect(store.create().getSnapshot()).toMatchObject({ open: true, activeId: 'session-diagnostics' })
  expect(() => c.ctx.settingsNavigation.openSection('missing-section')).toThrow('Settings section is unavailable')
  await c.unload('@deepseek-ai/dsh-client-ui-settings-general')
  await c.flush()
  expect(c.ctx.slots.entries('tool.call.action').some(entry => entry.options.id === 'session-diagnostics')).toBe(false)
  expect(c.ctx.slots.entries('sidebar.settings')).toHaveLength(0)
}, 60_000)
