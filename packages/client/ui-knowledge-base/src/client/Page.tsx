/** Workspace document management and source inspection over framework-owned resources. */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button, FileTypeIcon, IconBookOpenOutlineRegular, IconCloseOutlineRegular, IconPlusOutlineRegular,
  IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, IconSearchOutlineRegular, IconTrashOutlineRegular,
  Input, Modal, Select, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { KnowledgeGraph } from './Graph.tsx'
import type { Document, GraphNode, KnowledgePageInjected, ScopedDocument } from './types.ts'
import css from './Knowledge.module.css'

/** Complete page props assembled by the main Slot. */
export type KnowledgePageProps = PropsRuntime<'main'> & PropsLocale<'knowledgeBase'> & InjectFace<KnowledgePageInjected>

interface Selection {
  scope: WorkspaceId | null
  workspaceId: WorkspaceId | null
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
 * Render project or global document management, a source graph, and exact-revision passages.
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
  const address = workspaces.length === 0 ? ''
    : `dsh-resource://knowledge-dashboard/${encodeURIComponent(view.workspaceId ?? 'all')}?query=${encodeURIComponent(view.query)}&offset=${view.offset}`
  const resource = useResource<'knowledge-dashboard'>(address)
  const data = resource.value
  const unsupportedPlatform = data?.availability === 'unsupported-platform'
  const [draft, setDraft] = useState('')
  const [selection, setSelection] = useState<Selection | null>(null)
  const current = selection?.scope === view.workspaceId ? selection : null
  const selectedNode = data?.nodes.find(node => node.id === current?.nodeId)
  const keywordDocuments = selectedNode?.kind === 'keyword'
    ? new Set(data?.edges.filter(edge => edge.target === selectedNode.id).map(edge => edge.source)) : undefined
  const visibleDocuments = data?.documents.filter(item => keywordDocuments === undefined
    || data.nodes.some(node => node.documentId === item.documentId && node.workspaceId === item.workspaceId
      && keywordDocuments.has(node.id))) ?? []
  const document = visibleDocuments.find(item => current !== null
    && item.documentId === current.documentId && item.workspaceId === current.workspaceId)
    ?? visibleDocuments[0]
  const matching = data?.passages.find(item => document !== undefined
    && item.documentId === document.documentId && item.workspaceId === document.workspaceId)
  const selectedDocument = current?.documentId === document?.documentId && current?.workspaceId === document?.workspaceId
  const chunk = Math.min(selectedDocument ? current?.chunk ?? 0 : matching?.chunk ?? 0,
    Math.max(0, (document?.chunks ?? 1) - 1))
  const passageAddress = document === undefined ? ''
    : `dsh-resource://knowledge-passage/${encodeURIComponent(document.workspaceId)}/${encodeURIComponent(document.documentId)}?version=${encodeURIComponent(document.version)}&chunk=${chunk}`
  const passage = useResource<'knowledge-passage'>(passageAddress)
  const [importTarget, setImportTarget] = useState<WorkspaceId | null>(null)
  const [choosingImport, setChoosingImport] = useState(false)
  const importDestination = useRef<WorkspaceId | null>(null)
  const [reading, setReading] = useState(false)
  const [removing, setRemoving] = useState<PendingRemoval | null>(null)
  const [replacement, setReplacement] = useState<PendingUpload | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const reader = useRef<FileReader | null>(null)
  useEffect(() => () => { reader.current?.abort() }, [])
  const busy = view.busy !== null || reading
  function choose(node: GraphNode): void {
    setSelection({ scope: view.workspaceId, workspaceId: node.workspaceId, nodeId: node.id, documentId: node.documentId, chunk: 0 })
  }

  function open(item: ScopedDocument, chunk = 0): void {
    const node = data?.nodes.find(candidate => candidate.documentId === item.documentId && candidate.workspaceId === item.workspaceId)
    setSelection({ scope: view.workspaceId, workspaceId: item.workspaceId, nodeId: node?.id ?? null, documentId: item.documentId, chunk })
  }

  function pickFile(workspaceId: WorkspaceId): void {
    importDestination.current = workspaceId
    fileInput.current?.click()
  }

  async function importFile(file: File, workspaceId: WorkspaceId): Promise<void> {
    if (data === undefined || busy) return
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
      const result = await upload(workspaceId, file.name, base64, false)
      if (result === 'exists') setReplacement({ workspaceId, name: file.name, base64 })
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
    <header className={css.pageHead} data-window-drag>
      <div className={css.heading}>
        <h1>{t('title')}</h1>
        <p>{data !== undefined ? t('summary', { documents: count }) : null}</p>
      </div>
      <div className={css.headActions}>
        <div className={css.workspace}><Select aria-label={t('workspace')} value={view.workspaceId ?? ''} disabled={busy}
          options={[{ value: '', label: t('allWorkspaces') }, ...workspaces.map(item => ({ value: item.workspaceId, label: item.title }))]}
          onValueChange={(value) => {
            const selected = workspaces.find(item => item.workspaceId === value)
            selectWorkspace(selected?.workspaceId ?? null); setDraft(''); setSelection(null)
          }} /></div>
        <Button variant="primary" disabled={workspaces.length === 0 || data === undefined || unsupportedPlatform || busy}
          icon={<IconPlusOutlineRegular size={16} />} onClick={() => {
            if (workspace !== undefined) pickFile(workspace.workspaceId)
            else { setImportTarget(workspaces[0]?.workspaceId ?? null); setChoosingImport(true) }
          }}>
          {t(reading || view.busy === 'import' ? 'importing' : 'import')}
        </Button>
        <input ref={fileInput} type="file" hidden accept=".md,.markdown,.txt,.pdf" aria-label={t('import')}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file !== undefined && importDestination.current !== null) void importFile(file, importDestination.current)
          }} />
      </div>
    </header>
    <form className={css.searchBar} onSubmit={(event) => { event.preventDefault(); search(draft); setSelection(null) }}>
      <Input value={draft} placeholder={t('searchPlaceholder')} aria-label={t('search')}
        icon={<IconSearchOutlineRegular size={16} />} disabled={workspaces.length === 0 || unsupportedPlatform}
        onChange={(event) => { setDraft(event.target.value) }} />
      {draft !== '' && <Tooltip label={t('clearSearch')} portal><Button type="button" aria-label={t('clearSearch')}
        onClick={() => { setDraft(''); search(''); setSelection(null) }}><IconCloseOutlineRegular size={14} /></Button></Tooltip>}
      <Button type="submit" disabled={workspaces.length === 0 || unsupportedPlatform}>{t('search')}</Button>
    </form>
    {resource.status === 'failed' && <div className={css.notice} role="alert">
      <span>{t('loadFailed')}</span><Button onClick={refresh}>{t('retry')}</Button>
    </div>}
    <div className={css.content}>
      {workspaces.length === 0 ? workspacesPending ? loading : <div className={css.empty}><IconBookOpenOutlineRegular size={36} />
        <p>{t('noWorkspaces')}</p></div>
        : data === undefined ? resource.status === 'failed' ? null : loading
          : unsupportedPlatform ? <div className={css.empty} role="status"><IconBookOpenOutlineRegular size={40} />
            <p>{t('unsupportedPlatform')}</p></div>
            : empty ? <div className={css.empty}><IconBookOpenOutlineRegular size={40} />
              <h2>{t(view.query === '' ? 'emptyTitle' : 'emptyMatches')}</h2>
              {view.query === '' && <p>{t('supported')}</p>}
            </div> : <div className={css.body}>
              <section className={css.graphPanel}>
                <KnowledgeGraph key={view.workspaceId ?? 'all'} nodes={data.nodes} edges={data.edges}
                  selected={selectedNode?.id ?? null} select={choose} t={t} />
                {data.truncated && <span className={css.graphSummary}>{t('limited', { count: data.documents.length })}</span>}
              </section>
              <aside className={css.documentsPanel} aria-label={t('documents')}>
                <div className={css.panelHead}>
                  <h2>{selectedNode?.kind === 'keyword' ? selectedNode.label : t('documents')}</h2>
                  <span>{visibleDocuments.length}</span>
                  {selectedNode !== undefined && <Tooltip label={t('clearSelection')} portal><Button aria-label={t('clearSelection')}
                    onClick={() => { setSelection(null) }}><IconCloseOutlineRegular size={14} /></Button></Tooltip>}
                </div>
                <div className={css.documentList}>
                  {visibleDocuments.map(item => <article key={`${item.workspaceId}:${item.documentId}`} className={css.documentCard}
                    data-selected={document?.workspaceId === item.workspaceId && document.documentId === item.documentId}>
                    <button type="button" className={css.documentOpen} aria-label={`${t('openDocument')}: ${item.title}`}
                      aria-pressed={document?.workspaceId === item.workspaceId && document.documentId === item.documentId}
                      onClick={() => {
                        open(item, data.passages.find(match => match.workspaceId === item.workspaceId
                        && match.documentId === item.documentId)?.chunk ?? 0)
                      }}>
                      <FileTypeIcon path={item.title} size={24} />
                      <span className={css.documentMeta}><strong>{item.title}</strong>
                        {view.workspaceId === null && <small>{item.workspaceTitle}</small>}
                        <small>{t('chunks', { count: item.chunks })}</small>
                      </span>
                    </button>
                    <div className={css.documentActions}>
                      <Tooltip label={t('remove')} portal><Button aria-label={`${t('remove')} ${item.title}`} disabled={busy}
                        onClick={() => { setRemoving({ workspaceId: item.workspaceId, document: item }) }}>
                        <IconTrashOutlineRegular size={14} /></Button></Tooltip>
                    </div>
                  </article>)}
                </div>
                {view.query === '' && (view.offset > 0 || data.nextOffset !== null) && <div className={css.pagination}>
                  <Button disabled={view.offset === 0} onClick={() => {
                    page(Math.max(0, view.offset - data.pageSize)); setSelection(null)
                  }}>
                    {t('previousPage')}
                  </Button>
                  <Button disabled={data.nextOffset === null} onClick={() => {
                    if (data.nextOffset !== null) { page(data.nextOffset); setSelection(null) }
                  }}>{t('nextPage')}</Button>
                </div>}
                {document !== undefined && <section className={css.reader} aria-label={t('sourcePassages')}>
                  <div className={css.readerHead}>
                    <h2>{t('sourcePassages')}</h2>
                    {!document.source.startsWith('knowledge-upload://') && <p className={css.source}>{document.source}</p>}
                  </div>
                  {document.chunks > 1 && <div className={css.passageControls}>
                    <Tooltip label={t('previous')} portal><Button aria-label={t('previous')} disabled={chunk === 0}
                      onClick={() => { open(document, chunk - 1) }}><IconChevronLeftOutlineRegular size={16} /></Button></Tooltip>
                    <Select aria-label={t('sourcePassages')} value={String(chunk)}
                      options={Array.from({ length: document.chunks }, (_, index) => ({ value: String(index), label: t('passage', { current: index + 1, total: document.chunks }) }))}
                      onValueChange={(value) => { open(document, Number(value)) }} />
                    <Tooltip label={t('next')} portal><Button aria-label={t('next')} disabled={chunk + 1 >= document.chunks}
                      onClick={() => { open(document, chunk + 1) }}><IconChevronRightOutlineRegular size={16} /></Button></Tooltip>
                  </div>}
                  {passage.status === 'failed' && <div className={css.notice} role="alert"><span>{t('readFailed')}</span>
                    <Button onClick={refresh}>{t('retry')}</Button></div>}
                  {passage.value === undefined ? passage.status === 'failed' ? null : loading : <div className={css.passage}>
                    <p className={css.location}>{passage.value.page !== null ? t('page', { page: passage.value.page })
                      : passage.value.startLine !== null && passage.value.endLine !== null
                        ? t('lines', { from: passage.value.startLine, to: passage.value.endLine }) : null}</p>
                    <pre>{passage.value.text}</pre>
                  </div>}
                </section>}

              </aside>
            </div>}
    </div>
    <Modal open={choosingImport} title={t('importWorkspace')} closeLabel={t('close')} onClose={() => { setChoosingImport(false) }}>
      <Select aria-label={t('workspace')} value={importTarget ?? ''}
        options={workspaces.map(item => ({ value: item.workspaceId, label: item.title }))}
        onValueChange={(value) => { setImportTarget(workspaces.find(item => item.workspaceId === value)?.workspaceId ?? null) }} />
      <div className={css.dialogActions}><Button onClick={() => { setChoosingImport(false) }}>{t('cancel')}</Button>
        <Button variant="primary" disabled={importTarget === null} onClick={() => {
          if (importTarget !== null) { setChoosingImport(false); pickFile(importTarget) }
        }}>{t('chooseFile')}</Button></div>
    </Modal>
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
