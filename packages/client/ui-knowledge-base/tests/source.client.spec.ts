import { afterEach, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { createKnowledgeSource, waitForRefresh } from '../src/client/source.ts'
import { en } from '../src/client/locales.ts'
import type { Document } from '../src/client/types.ts'

const workspaceId = brandString<WorkspaceId>('workspace-a')
const document: Document = {
  documentId: brandString<Document['documentId']>('document-a'), title: 'guide.md',
  source: 'knowledge-upload://guide.md', version: 'revision-a', chunks: 1,
}
const sources: ReturnType<typeof createKnowledgeSource>[] = []
afterEach(async () => { await Promise.all(sources.splice(0).map(source => source.close())) })

function fixture() {
  type MutationApi = Parameters<typeof createKnowledgeSource>[0]
  const api: MutationApi = {
    upload: vi.fn<MutationApi['upload']>(async () => ({ ok: true, value: document })),
    deleteDocument: vi.fn<MutationApi['deleteDocument']>(async () => ({ ok: true, value: { documentId: document.documentId, removed: true } })),
  }
  const source = createKnowledgeSource(api, makeTranslate(en))
  sources.push(source)
  source.selectWorkspace(workspaceId)
  return { source, api }
}

it('requires explicit replacement after duplicate upload and refreshes only confirmed mutations', async () => {
  const { source, api } = fixture()
  vi.mocked(api.upload).mockResolvedValueOnce({ ok: false, error: new RemoteError('knowledge/operation-failed', 'Already exists', {
    reason: 'KNOWLEDGE_ALREADY_EXISTS',
  }) })
  expect(await source.upload(workspaceId, 'guide.md', 'YQ==', false)).toBe('exists')
  expect(source.revision.getSnapshot()).toBe(0)
  expect(await source.upload(workspaceId, 'guide.md', 'YQ==', true)).toBe('done')
  expect(source.revision.getSnapshot()).toBe(1)
  expect(source.notice.getSnapshot()).toMatchObject({ text: 'Imported guide.md', success: true })
  expect(await source.remove(workspaceId, document)).toBe(true)
  expect(source.revision.getSnapshot()).toBe(2)
  source.search('  subtitles  ')
  source.page(30)
  source.selectWorkspace(brandString<WorkspaceId>('workspace-b'))
  expect(source.view.getSnapshot()).toMatchObject({ query: '', offset: 0, busy: null })
})

it('aborts and awaits an admitted request before disposal and refuses later mutations', async () => {
  const { source, api } = fixture()
  let finish!: () => void
  vi.mocked(api.upload).mockImplementationOnce((_workspace, _name, _base64, _replace, signal) => new Promise((resolve) => {
    finish = () => { expect(signal?.aborted).toBe(true); resolve({ ok: true, value: document }) }
  }))
  const upload = source.upload(workspaceId, 'guide.md', 'YQ==', false)
  expect(await source.remove(workspaceId, document)).toBe(false)
  let closed = false
  const closing = source.close().then(() => { closed = true })
  expect(closed).toBe(false)
  finish()
  await Promise.all([closing, upload])
  expect(source.notice.getSnapshot()).toBeNull()
  expect(await source.upload(workspaceId, 'guide.md', 'YQ==', true)).toBe('failed')
  expect(api.upload).toHaveBeenCalledTimes(1)
})

it('wakes resource readers for refresh and releases subscriptions when cancelled', async () => {
  const revision = createSnapshotStore(0)
  const subscribe = vi.spyOn(revision, 'subscribe')
  const abort = new AbortController()
  expect(await waitForRefresh(revision, -1, abort.signal)).toBe(true)
  const waiting = waitForRefresh(revision, 0, abort.signal)
  revision.set(1)
  expect(await waiting).toBe(true)
  const cancelled = waitForRefresh(revision, 1, abort.signal)
  abort.abort()
  expect(await cancelled).toBe(false)
  expect(subscribe).toHaveBeenCalledTimes(2)
})
