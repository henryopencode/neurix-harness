/** Bounded global browsing through the existing workspace-authorized Remote methods. */
import { brandString } from '@deepseek-ai/dsh-brand'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { Dashboard, DashboardResult, GraphNode, KnowledgeApi, KnowledgeWorkspace } from './types.ts'

type RequestDashboard = (...args: Parameters<KnowledgeApi['dashboard']>) => ReturnType<KnowledgeApi['dashboard']>

function append(target: Dashboard, source: DashboardResult, workspace: KnowledgeWorkspace, limit: number): void {
  const documents = source.documents.slice(0, limit)
  const ids = new Set(documents.map(document => document.documentId))
  const documentNodes = new Set(source.nodes.filter(node => node.documentId !== null && ids.has(node.documentId)).map(node => node.id))
  const nodeId = (id: GraphNode['id']): GraphNode['id'] => documentNodes.has(id)
    ? brandString<GraphNode['id']>(`${workspace.workspaceId}:${id}`) : id
  const edges = source.edges.filter(edge => documentNodes.has(edge.source))
  const keywords = new Set(edges.map(edge => edge.target))
  const existingNodes = new Set(target.nodes.map(node => node.id))
  target.documents.push(...documents.map(document => ({
    ...document, workspaceId: workspace.workspaceId, workspaceTitle: workspace.title,
  })))
  target.passages.push(...source.passages.filter(passage => ids.has(passage.documentId))
    .map(passage => ({ ...passage, workspaceId: workspace.workspaceId })))
  for (const node of source.nodes) {
    if (!documentNodes.has(node.id) && !keywords.has(node.id)) continue
    const id = nodeId(node.id)
    if (!existingNodes.has(id)) target.nodes.push({ ...node, id, workspaceId: node.kind === 'document' ? workspace.workspaceId : null })
  }
  target.edges.push(...edges.map(edge => ({ ...edge, source: nodeId(edge.source) })))
}

/**
 * Read a single bounded page without relaxing workspace authorization or mixing document identities.
 * @param request - Existing generated Remote method, which authorizes every project separately.
 * @param workspaces - Projects visible to the active client, in their displayed order.
 * @param selected - One project, or null for all visible projects.
 * @param query - Optional full-text query; each project's existing result limit still applies.
 * @param offset - Global document offset for unfiltered browsing.
 * @param signal - Resource lifetime, forwarded to every Remote request.
 * @returns Combined totals and at most one configured page of documents, or the first project failure.
 */
export async function loadDashboard(
  request: RequestDashboard, workspaces: readonly KnowledgeWorkspace[], selected: WorkspaceId | null,
  query: string, offset: number, signal: AbortSignal,
): Promise<RemoteResult<Dashboard>> {
  const projects = selected === null ? workspaces : workspaces.filter(workspace => workspace.workspaceId === selected)
  let combined: Dashboard | undefined
  let skip = offset
  let totalDocuments = 0
  let totalPassages = 0
  let limited = false
  for (const workspace of projects) {
    signal.throwIfAborted()
    const first = await request(workspace.workspaceId, query, selected === null ? 0 : offset, signal)
    if (!first.ok) return first
    const value = first.value
    combined ??= { ...value, documents: [], passages: [], nodes: [], edges: [] }
    totalDocuments += value.totalDocuments
    totalPassages += value.totalPassages
    if (selected === null && query === '' && skip >= value.totalDocuments) { skip -= value.totalDocuments; continue }
    const capacity = combined.pageSize - combined.documents.length
    if (capacity === 0) { limited ||= value.documents.length > 0; continue }
    let source = value
    if (selected === null && query === '' && skip > 0) {
      const page = await request(workspace.workspaceId, query, skip, signal)
      if (!page.ok) return page
      source = page.value
    }
    skip = 0
    append(combined, source, workspace, capacity)
    limited ||= source.truncated || source.documents.length > capacity
  }
  signal.throwIfAborted()
  if (combined === undefined) return { ok: false, error: new RemoteError('gateway/bad-request', 'Workspace is unavailable.', {}) }
  return { ok: true, value: {
    ...combined, totalDocuments, totalPassages,
    nextOffset: query === '' && offset + combined.documents.length < totalDocuments ? offset + combined.documents.length : null,
    truncated: query === '' ? totalDocuments > combined.documents.length : limited,
  } }
}
