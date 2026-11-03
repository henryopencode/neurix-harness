// @vitest-environment jsdom
/** Page interactions keep drafts and distinguish connection states. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type {} from '../src/client/index.ts'
import { McpPage, type McpPageProps } from '../src/client/McpPage.tsx'
import { en, type McpLocaleKey } from '../src/client/locales.ts'
import type { McpManagerSnapshot, McpServerId } from '../src/types.ts'

const t = ((key: McpLocaleKey, values?: Record<string, string | number>) => Object.entries(values ?? {})
  .reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key])) as McpPageProps['t']
const snapshot: McpManagerSnapshot = {
  revision: 'v1', writable: true, recoveryRequired: false,
  servers: [{ id: 'knowledge' as McpServerId, serverName: 'knowledge', enabled: true, editable: true, removable: true,
    draft: { serverName: 'knowledge', transport: 'stdio', command: 'ssh', args: ['-T', 'host'], cwd: '', url: '' },
    connection: { state: 'connected', tools: [{ name: 'mcp__knowledge__search', description: 'Search notes' }] } }],
}
function props(value = snapshot): McpPageProps {
  return {
    t, useResource: () => ({ status: 'live', value }), save: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true), setEnabled: vi.fn().mockResolvedValue(true), reconnect: vi.fn().mockResolvedValue(true),
  } as McpPageProps
}
afterEach(cleanup)

it('shows connection and tool names and filters without changing server enablement', () => {
  const input = props()
  render(<McpPage {...input} />)
  expect(screen.getByText('Connected')).toBeTruthy()
  fireEvent.click(screen.getByText('Tools (1)'))
  expect(screen.getByText('mcp__knowledge__search')).toBeTruthy()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no-match' } })
  expect(screen.getByText('No matching servers')).toBeTruthy()
  expect(input.setEnabled).not.toHaveBeenCalled()
})

it('requires valid credential JSON and preserves credentials when its edit field is empty', async () => {
  const input = props()
  render(<McpPage {...input} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  const form = within(screen.getByRole('dialog'))
  expect(form.getByLabelText<HTMLTextAreaElement>('Arguments (one per line)').value).toBe('-T\nhost')
  const field = form.getByLabelText<HTMLTextAreaElement>('Environment variables (JSON)')
  expect(field.value).toBe('')
  fireEvent.change(field, { target: { value: '{"TOKEN":42}' } })
  fireEvent.click(form.getByRole('button', { name: 'Save' }))
  expect(form.getByRole('alert').textContent).toBe(en.invalidCredentials)
  expect(input.save).not.toHaveBeenCalled()
  fireEvent.change(field, { target: { value: '' } })
  fireEvent.click(form.getByRole('button', { name: 'Save' }))
  await waitFor(() => { expect(input.save).toHaveBeenCalledWith('knowledge', snapshot.servers[0]?.draft, 'v1') })
})

it('keeps the server until removal is confirmed', async () => {
  const input = props()
  render(<McpPage {...input} />)
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  expect(input.remove).not.toHaveBeenCalled()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('heading', { name: 'knowledge' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))
  await waitFor(() => { expect(input.remove).toHaveBeenCalledWith('knowledge', 'v1') })
})
