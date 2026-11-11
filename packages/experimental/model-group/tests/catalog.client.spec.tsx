import { contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
// @vitest-environment jsdom
/** Group members are selected from the shared configured model catalog. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { allowAllAccess, bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { GroupSettings } from '../../client-ui-model-group/src/client/GroupSettings.tsx'
import type { GroupSettingsState } from '../../client-ui-model-group/src/client/settings.ts'
import { zh } from '../../client-ui-model-group/src/client/locales.ts'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'

afterEach(cleanup)

it('selects an exact configured route and repairs the leader when removing it', () => {
  const field = (text: string) => ({ text, invalid: false, overridden: false })
  const settings = createSnapshotStore<GroupSettingsState>({
    available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
    defaultMode: field('multi'), leader: field('a'), maxParallel: field('3'),
    members: [{ name: 'a', label: 'Configured A', provider: 'custom', model: 'a', strengths: 'Code' }],
  })
  const catalog: ModelCatalog = {
    default: { provider: 'custom', model: 'a' }, routableProviders: ['custom'], failures: [],
    groups: [{ id: 'custom', name: 'Configured provider', models: [{ id: 'a', name: 'Configured A' }, { id: 'b', name: 'Configured B' }] }],
  }
  const directory = createSnapshotStore({ value: catalog, status: 'ready' as const, error: null })
  const setMembers = vi.fn()
  const unusedHook = (): never => { throw new Error('Group settings do not read global state') }
  const standard = {
    usePanelInfo: unusedHook, useSessions: unusedHook, useWorkspaces: unusedHook,
    useSessionStatus: unusedHook, useSessionRetainInfo: unusedHook, useResource: unusedHook,
    ...allowAllAccess, useContextMenu: contextMenuHook(),
  }
  render(<GroupSettings view="page" t={makeTranslate(zh)} useGroupSettings={bindSnapshotSelector(settings)}
    useGroupCatalog={bindSnapshotSelector(directory)} refreshCatalog={vi.fn()} setMembers={setMembers}
    edit={vi.fn()} resetField={vi.fn()} save={vi.fn()} discard={vi.fn()} {...standard} />)
  expect(screen.queryByRole('textbox', { name: /provider|model id|api/i })).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Configured B' }))
  expect(setMembers).toHaveBeenLastCalledWith([
    settings.getSnapshot().members[0], { name: 'b', label: 'Configured B', provider: 'custom', model: 'b', strengths: '' },
  ], 'a')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Configured A' }))
  expect(setMembers).toHaveBeenLastCalledWith([], '')
})
