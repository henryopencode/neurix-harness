import { expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { loadDashboard } from '../src/client/dashboard.ts'
import type { DashboardResult, KnowledgeWorkspace } from '../src/client/types.ts'

const projects: KnowledgeWorkspace[] = ['a', 'b'].map(id => ({
  workspaceId: brandString<KnowledgeWorkspace['workspaceId']>(id), title: id, path: `/project-${id}`,
  sessionIds: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}))

function snapshot(ids: string[], offset = 0): DashboardResult {
  const documents = ids.slice(offset, offset + 2).map(id => ({
    documentId: brandString<DashboardResult['documents'][number]['documentId']>(id),
    source: 'knowledge-upload://guide.md', title: 'guide.md', version: 'revision', chunks: 1,
  }))
  const keyword = brandString<DashboardResult['nodes'][number]['id']>('keyword:shared')
  return {
    availability: 'ready', totalDocuments: ids.length, totalPassages: ids.length, documents, passages: [],
    nodes: [...documents.map(document => ({
      id: brandString<DashboardResult['nodes'][number]['id']>(`document:${document.documentId}`),
      kind: 'document' as const, label: document.title, documentId: document.documentId,
    })), { id: keyword, kind: 'keyword', label: 'shared', documentId: null }],
    edges: documents.map(document => ({
      source: brandString<DashboardResult['nodes'][number]['id']>(`document:${document.documentId}`), target: keyword, occurrences: 1,
    })), nextOffset: offset + documents.length < ids.length ? offset + documents.length : null,
    truncated: ids.length > documents.length, pageSize: 2, maxFileBytes: 1024,
  }
}

it('pages across projects, distinguishes duplicate source identities, and joins shared keywords', async () => {
  const request = vi.fn<Parameters<typeof loadDashboard>[0]>(async (workspace, _query, offset) => ({
    ok: true, value: snapshot(workspace === 'a' ? ['one', 'two', 'same'] : ['same'], offset),
  }))
  const signal = new AbortController().signal
  const first = await loadDashboard(request, projects, null, '', 0, signal)
  expect(first.ok && first.value.documents.map(document => document.documentId)).toEqual(['one', 'two'])
  expect(first.ok && first.value.nextOffset).toBe(2)
  const second = await loadDashboard(request, projects, null, '', 2, signal)
  if (!second.ok) throw second.error
  expect(second.value).toMatchObject({ totalDocuments: 4, totalPassages: 4, nextOffset: null })
  expect(second.value.documents.map(document => document.workspaceId)).toEqual(['a', 'b'])
  expect(second.value.nodes.filter(node => node.kind === 'document').map(node => node.id)).toEqual(['a:document:same', 'b:document:same'])
  expect(second.value.nodes.filter(node => node.kind === 'keyword')).toHaveLength(1)
  expect(second.value.edges.map(edge => edge.source)).toEqual(['a:document:same', 'b:document:same'])
})

it('bounds global search and keeps project filtering on the existing authorized method', async () => {
  const request = vi.fn<Parameters<typeof loadDashboard>[0]>(async () => ({ ok: true, value: snapshot(['one', 'two']) }))
  const signal = new AbortController().signal
  const result = await loadDashboard(request, projects, null, 'shared', 0, signal)
  expect(result.ok && result.value.documents).toHaveLength(2)
  expect(result.ok && result.value.truncated).toBe(true)
  request.mockClear()
  await loadDashboard(request, projects, projects[1]!.workspaceId, '', 0, signal)
  expect(request).toHaveBeenCalledExactlyOnceWith(projects[1]!.workspaceId, '', 0, signal)
})

it('propagates a project failure and stops further reads after resource cancellation', async () => {
  const error = new RemoteError('gateway/bad-request', 'Project unavailable', {})
  const rejected = vi.fn<Parameters<typeof loadDashboard>[0]>(async () => ({ ok: false, error }))
  expect(await loadDashboard(rejected, projects, null, '', 0, new AbortController().signal)).toEqual({ ok: false, error })
  expect(rejected).toHaveBeenCalledTimes(1)
  const lifetime = new AbortController()
  const cancelled = vi.fn<Parameters<typeof loadDashboard>[0]>(async () => {
    lifetime.abort()
    return { ok: true, value: snapshot(['one']) }
  })
  await expect(loadDashboard(cancelled, projects, null, '', 0, lifetime.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(cancelled).toHaveBeenCalledTimes(1)
})

it('keeps search passages with their project and omits nodes outside the global page', async () => {
  const request = vi.fn<Parameters<typeof loadDashboard>[0]>(async (workspace) => {
    const value = snapshot(workspace === 'a' ? ['one'] : ['two', 'three'])
    return { ok: true, value: { ...value, passages: value.documents.map(document => ({
      ...document, text: `Text for ${document.documentId}`, chunk: 0, page: null, startLine: 1, endLine: 1,
    })) } }
  })
  const result = await loadDashboard(request, projects, null, 'shared', 0, new AbortController().signal)
  if (!result.ok) throw result.error
  expect(result.value.passages.map(passage => [passage.documentId, passage.workspaceId])).toEqual([['one', 'a'], ['two', 'b']])
  expect(result.value.nodes.filter(node => node.kind === 'document').map(node => node.id)).toEqual(['a:document:one', 'b:document:two'])
  expect(result.value.edges).toHaveLength(2)
})

it('continues in the next project when the global offset skips an entire collection', async () => {
  const request = vi.fn<Parameters<typeof loadDashboard>[0]>(async workspace => ({
    ok: true, value: snapshot(workspace === 'a' ? ['one', 'two'] : ['three']),
  }))
  const result = await loadDashboard(request, projects, null, '', 2, new AbortController().signal)
  expect(result.ok && result.value.documents.map(document => document.documentId)).toEqual(['three'])
  expect(result.ok && result.value.nextOffset).toBeNull()
})

it('reports unavailable projects without issuing an unauthorized request', async () => {
  const request = vi.fn<Parameters<typeof loadDashboard>[0]>()
  const result = await loadDashboard(request, [], null, '', 0, new AbortController().signal)
  expect(result).toMatchObject({ ok: false, error: { code: 'gateway/bad-request' } })
  expect(request).not.toHaveBeenCalled()
})

it('returns a page-read failure without substituting the first page or reading another project', async () => {
  const error = new RemoteError('gateway/bad-request', 'Project unavailable', {})
  const request = vi.fn<Parameters<typeof loadDashboard>[0]>(async (_workspace, _query, offset) => offset === 0
    ? { ok: true, value: snapshot(['one', 'two', 'three']) } : { ok: false, error })
  const result = await loadDashboard(request, projects, null, '', 1, new AbortController().signal)
  expect(result).toEqual({ ok: false, error })
  expect(request).toHaveBeenCalledTimes(2)
})
