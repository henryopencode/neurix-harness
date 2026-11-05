// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { allowAllAccess, makeTranslate, workspaceSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { KnowledgePage, type KnowledgePageProps } from '../src/client/Page.tsx'
import { en } from '../src/client/locales.ts'
import type { Dashboard, Document, ViewState } from '../src/client/types.ts'

afterEach(cleanup)

const workspaceId = brandString<WorkspaceId>('workspace-a')
const sourceDocument: Document = { documentId: brandString<Document['documentId']>('document-a'),
  source: 'knowledge-upload://guide.md', title: 'guide.md', version: 'revision-a', chunks: 1 }
const dashboard: Dashboard = {
  availability: 'ready', totalDocuments: 1, totalPassages: 1, documents: [sourceDocument], passages: [], nextOffset: null,
  truncated: false, pageSize: 30, maxFileBytes: 1024,
  nodes: [
    { id: brandString<Dashboard['nodes'][number]['id']>('document:a'), kind: 'document', label: sourceDocument.title, documentId: sourceDocument.documentId },
    { id: brandString<Dashboard['nodes'][number]['id']>('keyword:a'), kind: 'keyword', label: 'subtitles', documentId: null },
  ],
  edges: [{ source: brandString<Dashboard['nodes'][number]['id']>('document:a'), target: brandString<Dashboard['nodes'][number]['id']>('keyword:a'), occurrences: 2 }],
}

function fixture(value: Dashboard = dashboard) {
  let view: ViewState = { workspaceId, query: '', offset: 0, busy: null }
  const workspaces = { ...workspaceSnapshot(), phase: 'ready' as const, items: [{ workspaceId,
    path: '/project', title: 'Project', sessionIds: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }] }
  const resources = vi.fn((address: string) => ({ status: 'live' as const, failure: undefined,
    value: address.includes('knowledge-dashboard') ? value : address.includes('knowledge-passage')
      ? { ...sourceDocument, chunk: 0, page: null, startLine: 2, endLine: 2, text: '<script>untrusted reference</script>' } : undefined,
  }))
  const unused = (): never => { throw new Error('Unused standard hook') }
  const props: KnowledgePageProps = {
    t: makeTranslate(en), useView: select => select(view), useWorkspaces: select => select(workspaces),
    useResource: resources as KnowledgePageProps['useResource'],
    useSessions: unused, usePanelInfo: unused, useSessionStatus: unused, useSessionRetainInfo: unused,
    ...allowAllAccess,
    selectWorkspace: vi.fn(), search: vi.fn(), page: vi.fn(), refresh: vi.fn(),
    upload: vi.fn<KnowledgePageProps['upload']>(async () => 'done'), remove: vi.fn(async () => true), report: vi.fn(),
  }
  const rendered = render(<KnowledgePage {...props} />)
  return { props, resources, switchWorkspace: (): void => {
    const nextWorkspace = brandString<WorkspaceId>('workspace-b')
    view = { ...view, workspaceId: nextWorkspace }
    workspaces.items = [{ ...workspaces.items[0]!, workspaceId: nextWorkspace }]
    rendered.rerender(<KnowledgePage {...props} />)
  } }
}

it('filters through graph keywords and reads escaped source text with its original location', () => {
  const { props, resources } = fixture()
  fireEvent.click(screen.getByRole('button', { name: 'Keyword: subtitles' }))
  expect(screen.getByRole('heading', { name: 'subtitles' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Read source: guide.md' }))
  expect(screen.getByText('Lines 2–2')).toBeTruthy()
  expect(screen.getByText('<script>untrusted reference</script>')).toBeTruthy()
  expect(document.querySelector('script')).toBeNull()
  expect(resources.mock.calls.some(([address]) => address.includes('version=revision-a&chunk=0'))).toBe(true)
  fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'subtitles' } })
  fireEvent.submit(screen.getByRole('textbox', { name: 'Search' }).closest('form')!)
  expect(props.search).toHaveBeenCalledWith('subtitles')
})

it('captures the document workspace when removal is opened and mutates only after confirmation', async () => {
  const { props, switchWorkspace } = fixture()
  fireEvent.click(screen.getByRole('button', { name: 'Remove guide.md' }))
  expect(props.remove).not.toHaveBeenCalled()
  switchWorkspace()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))
  await waitFor(() => { expect(props.remove).toHaveBeenCalledWith(workspaceId, sourceDocument) })
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
})

it('keeps its built-in page visible and explains an unavailable native index', () => {
  fixture({ ...dashboard, availability: 'unsupported-platform', documents: [], nodes: [], edges: [], totalDocuments: 0, totalPassages: 0 })
  expect(screen.getByText(en.unsupportedPlatform)).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Import document' }).disabled).toBe(true)
  expect(screen.queryByText('No documents yet')).toBeNull()
})
