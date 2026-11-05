/** Workspace document management and source inspection over framework-owned resources. */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button, FileTypeIcon, IconBookmarkOutlineRegular, IconCloseOutlineRegular, IconPlusOutlineRegular,
  IconRefreshOutlineRegular, IconSearchOutlineRegular, IconTrashOutlineRegular, Input, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { KnowledgeGraph } from './Graph.tsx'
import type { Document, GraphNode, KnowledgePageInjected } from './types.ts'
import css from './Knowledge.module.css'

/** Complete page props assembled by the main Slot. */
export type KnowledgePageProps = PropsRuntime<'main'> & PropsLocale<'knowledgeBase'> & InjectFace<KnowledgePageInjected>

interface Selection {
  workspaceId: WorkspaceId
  nodeId: GraphNode['id'] | null
  documentId: Document['documentId'] | null
  chunk: number
}

interface PendingUpload {
  workspaceId: WorkspaceId
  name: string
  base64: string
}

interface PendingRemoval {
  workspaceId: WorkspaceId
  document: Document
}

/**
 * Render document management, a literal keyword graph, and exact-revision source reads.
 * @param props - Framework resource hooks, localized copy, reactive intent, and plain operation callbacks.
 * @returns The responsive management page; source values remain owned by useResource.
 */
export function KnowledgePage({
  t, useView, useWorkspaces, useResource, selectWorkspace, search, page, refresh, upload, remove, report,
}: KnowledgePageProps): ReactNode {
  const view = useView(value => value)
  const workspaces = useWorkspaces(value => value.items)
  const workspacesPending = useWorkspaces(value => value.phase === 'pending' && value.error === null)
  const workspace = workspaces.find(item => item.workspaceId === view.workspaceId)
  const address = workspace === undefined ? ''
    : `dsh-resource://knowledge-dashboard/${encodeURIComponent(workspace.workspaceId)}?query=${encodeURIComponent(view.query)}&offset=${view.offset}`
  const resource = useResource<'knowledge-dashboard'>(address)
  const data = resource.value
  const [draft, setDraft] = useState('')
  const [selection, setSelection] = useState<Selection | null>(null)
  const current = selection?.workspaceId === workspace?.workspaceId ? selection : null
  const selectedNode = data?.nodes.find(node => node.id === current?.nodeId)
  const document = data?.documents.find(item => item.documentId === current?.documentId)
  const chunk = Math.min(current?.chunk ?? 0, Math.max(0, (document?.chunks ?? 1) - 1))
  const passageAddress = workspace === undefined || document === undefined ? ''
    : `dsh-resource://knowledge-passage/${encodeURIComponent(workspace.workspaceId)}/${encodeURIComponent(document.documentId)}?version=${encodeURIComponent(document.version)}&chunk=${chunk}`
  const passage = useResource<'knowledge-passage'>(passageAddress)
  const [reading, setReading] = useState(false)
  const [removing, setRemoving] = useState<PendingRemoval | null>(null)
  const [replacement, setReplacement] = useState<PendingUpload | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const reader = useRef<FileReader | null>(null)
  useEffect(() => () => { reader.current?.abort() }, [])
  const busy = view.busy !== null || reading
  const keywordDocuments = selectedNode?.kind === 'keyword'
    ? new Set(data?.edges.filter(edge => edge.target === selectedNode.id).map(edge => edge.source)) : undefined
  const visibleDocuments = data?.documents.filter(item => keywordDocuments === undefined
    || data.nodes.some(node => node.documentId === item.documentId && keywordDocuments.has(node.id))) ?? []

  function choose(node: GraphNode): void {
    if (workspace === undefined) return
    setSelection({ workspaceId: workspace.workspaceId, nodeId: node.id, documentId: node.documentId, chunk: 0 })
  }

  function open(item: Document): void {
    if (workspace === undefined) return
    const node = data?.nodes.find(candidate => candidate.documentId === item.documentId)
    const matching = data?.passages.find(candidate => candidate.documentId === item.documentId)
    setSelection({ workspaceId: workspace.workspaceId, nodeId: node?.id ?? null, documentId: item.documentId, chunk: matching?.chunk ?? 0 })
  }

  async function importFile(file: File): Promise<void> {
    if (workspace === undefined || data === undefined || busy) return
    if (!/\.(?:md|markdown|txt|pdf)$/iu.test(file.name)) { report(t('unsupported')); return }
    if (file.size > data.maxFileBytes) { report(t('tooLarge', { size: Math.round(data.maxFileBytes / 1048576) })); return }
    setReading(true)
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const selectedReader = new FileReader()
        reader.current = selectedReader
        selectedReader.onload = () => {
          if (typeof selectedReader.result !== 'string') { reject(new Error('Expected file data URL')); return }
          resolve(selectedReader.result.slice(selectedReader.result.indexOf(',') + 1))
        }
        selectedReader.onerror = () => { reject(selectedReader.error ?? new Error('File read failed')) }
        selectedReader.onabort = () => { reject(new DOMException('File read aborted', 'AbortError')) }
        selectedReader.readAsDataURL(file)
      })
      const result = await upload(workspace.workspaceId, file.name, base64, false)
      if (result === 'exists') setReplacement({ workspaceId: workspace.workspaceId, name: file.name, base64 })
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) report(t('actionFailed'))
    } finally {
      reader.current = null
      setReading(false)
    }
  }

  const count = data?.totalDocuments ?? 0
  const empty = data !== undefined && data.documents.length === 0
  const loading = <div className={css.loading}><span className={css.spinner} role="status" aria-label={t('loading')} /></div>
  return <section className={css.page}>
    <header className={css.pageHead}>
      <div className={css.heading}>
        <h1>{t('title')}</h1>
        {data !== undefined && count > 0 && <p>{t('summary', { documents: count, passages: data.totalPassages })}</p>}
      </div>
      <div className={css.headActions}>
        <select className={css.workspace} aria-label={t('workspace')} value={workspace?.workspaceId ?? ''} disabled={busy}
          onChange={(event) => {
            const selected = workspaces.find(item => item.workspaceId === event.target.value)
            if (selected !== undefined) { selectWorkspace(selected.workspaceId); setDraft(''); setSelection(null) }
          }}>
          {workspace === undefined && <option value="">{t('chooseWorkspace')}</option>}
          {workspaces.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title}</option>)}
        </select>
        <Tooltip label={t('refresh')} portal><Button aria-label={t('refresh')} disabled={workspace === undefined || busy}
          onClick={refresh}><IconRefreshOutlineRegular size={16} /></Button></Tooltip>
        <Button variant="primary" disabled={workspace === undefined || data === undefined || busy}
          icon={<IconPlusOutlineRegular size={16} />} onClick={() => { fileInput.current?.click() }}>
          {t(reading || view.busy === 'import' ? 'importing' : 'import')}
        </Button>
        <input ref={fileInput} type="file" hidden accept=".md,.markdown,.txt,.pdf" aria-label={t('import')}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file !== undefined) void importFile(file)
          }} />
      </div>
    </header>
    <form className={css.searchBar} onSubmit={(event) => { event.preventDefault(); search(draft); setSelection(null) }}>
      <Input value={draft} placeholder={t('searchPlaceholder')} aria-label={t('search')}
        icon={<IconSearchOutlineRegular size={16} />} disabled={workspace === undefined}
        onChange={(event) => { setDraft(event.target.value) }} />
      {draft !== '' && <Tooltip label={t('clearSearch')} portal><Button type="button" aria-label={t('clearSearch')}
        onClick={() => { setDraft(''); search(''); setSelection(null) }}><IconCloseOutlineRegular size={14} /></Button></Tooltip>}
      <Button type="submit" disabled={workspace === undefined}>{t('search')}</Button>
    </form>
    {resource.status === 'failed' && <div className={css.notice} role="alert">
      <span>{t('loadFailed')}</span><Button onClick={refresh}>{t('retry')}</Button>
    </div>}
    {workspace === undefined ? workspacesPending ? loading : <div className={css.empty}><IconBookmarkOutlineRegular size={36} />
      <p>{t(workspaces.length > 0 ? 'chooseWorkspace' : 'noWorkspaces')}</p></div>
      : data === undefined ? resource.status === 'failed' ? null : loading
        : empty ? <div className={css.empty}><IconBookmarkOutlineRegular size={40} />
          <h2>{t(view.query === '' ? 'emptyTitle' : 'emptyMatches')}</h2>
          {view.query === '' && <p>{t('supported')}</p>}
        </div> : <div className={css.body}>
          <section className={css.graphPanel}>
            <KnowledgeGraph key={workspace.workspaceId} nodes={data.nodes} edges={data.edges}
              selected={selectedNode?.id ?? null} select={choose} t={t} />
            {data.truncated && <span className={css.graphSummary}>{t('limited', { count: data.documents.length })}</span>}
          </section>
          <aside className={css.documentsPanel} aria-label={t('documents')}>
            {document === undefined ? <>
              <div className={css.panelHead}>
                <h2>{selectedNode?.kind === 'keyword' ? selectedNode.label : t('documents')}</h2>
                <span>{visibleDocuments.length}</span>
                {selectedNode !== undefined && <Tooltip label={t('clearSelection')} portal><Button aria-label={t('clearSelection')}
                  onClick={() => { setSelection(null) }}><IconCloseOutlineRegular size={14} /></Button></Tooltip>}
              </div>
              <div className={css.documentList}>
                {visibleDocuments.map(item => <article key={item.documentId} className={css.documentCard}>
                  <button type="button" className={css.documentOpen} aria-label={`${t('openDocument')}: ${item.title}`}
                    onClick={() => { open(item) }}>
                    <FileTypeIcon path={item.title} size={24} />
                    <span className={css.documentMeta}><strong>{item.title}</strong><small>{t('chunks', { count: item.chunks })}</small></span>
                  </button>
                  <div className={css.documentActions}>
                    <Tooltip label={t('remove')} portal><Button aria-label={`${t('remove')} ${item.title}`} disabled={busy}
                      onClick={() => { setRemoving({ workspaceId: workspace.workspaceId, document: item }) }}>
                      <IconTrashOutlineRegular size={14} /></Button></Tooltip>
                  </div>
                </article>)}
              </div>
              {view.query === '' && (view.offset > 0 || data.nextOffset !== null) && <div className={css.pagination}>
                <Button disabled={view.offset === 0} onClick={() => { page(Math.max(0, view.offset - data.pageSize)); setSelection(null) }}>
                  {t('previousPage')}
                </Button>
                <Button disabled={data.nextOffset === null} onClick={() => {
                  if (data.nextOffset !== null) { page(data.nextOffset); setSelection(null) }
                }}>{t('nextPage')}</Button>
              </div>}
            </> : <>
              <div className={css.readerHead}>
                <Button onClick={() => { setSelection(null) }}>{t('showAll')}</Button>
                <h2>{document.title}</h2>
                {!document.source.startsWith('knowledge-upload://') && <p className={css.source}>{document.source}</p>}
              </div>
              <div className={css.passageControls}>
                <Button disabled={chunk === 0} onClick={() => { if (current !== null) setSelection({ ...current, chunk: chunk - 1 }) }}>
                  {t('previous')}
                </Button>
                <span>{t('passage', { current: chunk + 1, total: document.chunks })}</span>
                <Button disabled={chunk + 1 >= document.chunks}
                  onClick={() => { if (current !== null) setSelection({ ...current, chunk: chunk + 1 }) }}>{t('next')}</Button>
              </div>
              {passage.status === 'failed' && <p className={css.notice} role="alert">{t('readFailed')}</p>}
              {passage.value === undefined ? passage.status === 'failed' ? null : <div className={css.loading}><span className={css.spinner} role="status"
                aria-label={t('loading')} /></div> : <div className={css.passage}>
                <p className={css.location}>{passage.value.page !== null ? t('page', { page: passage.value.page })
                  : passage.value.startLine !== null && passage.value.endLine !== null
                    ? t('lines', { from: passage.value.startLine, to: passage.value.endLine }) : null}</p>
                <pre>{passage.value.text}</pre>
              </div>}
            </>}
          </aside>
        </div>}
    <Modal open={removing !== null} title={t('removeTitle')} closeLabel={t('close')}
      onClose={() => { if (!busy) setRemoving(null) }}>
      <p className={css.dialogText}>{t('removeConfirm', { name: removing?.document.title ?? '' })}</p>
      <div className={css.dialogActions}><Button disabled={busy} onClick={() => { setRemoving(null) }}>{t('cancel')}</Button>
        <Button variant="primary" disabled={busy} onClick={() => {
          if (removing !== null) void remove(removing.workspaceId, removing.document).then((removed) => {
            if (removed) { setRemoving(null); setSelection(null) }
          })
        }}>{t('remove')}</Button></div>
    </Modal>
    <Modal open={replacement !== null} title={t('replaceTitle')} closeLabel={t('close')}
      onClose={() => { if (!busy) setReplacement(null) }}>
      <p className={css.dialogText}>{t('replaceConfirm', { name: replacement?.name ?? '' })}</p>
      <div className={css.dialogActions}><Button disabled={busy} onClick={() => { setReplacement(null) }}>{t('cancel')}</Button>
        <Button variant="primary" disabled={busy} onClick={() => {
          if (replacement !== null) void upload(replacement.workspaceId, replacement.name, replacement.base64, true).then((result) => {
            if (result === 'done') setReplacement(null)
          })
        }}>{t('update')}</Button></div>
    </Modal>
  </section>
}
