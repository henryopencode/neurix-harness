/** Workspace-authorized document management over the existing typed Gateway. */

import { createHash } from 'node:crypto'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-workspace'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import { KnowledgeError } from './errors.ts'
import type { KnowledgeDashboard, KnowledgeDocument, KnowledgeDocumentId, KnowledgePassage, KnowledgeRemoval, KnowledgeSpace } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Workspace-scoped knowledge management Remote owner. */
    knowledgeController: KnowledgeController
  }
}

/** One Remote namespace for knowledge management, without changing the Agent tools. */
export class KnowledgeController extends TypertRemoteService {
  static inject = ['knowledgeBase', 'typert', 'workspaceRegistry', 'workspaceController', 'remoteAccess']

  constructor(ctx: Context) {
    super(ctx, 'knowledgeController', { namespace: 'knowledge' })
  }

  private space(workspaceId: WorkspaceId): KnowledgeSpace {
    const workspace = this.ctx.workspaceRegistry.get(workspaceId)
    if (workspace === undefined) throw new RemoteError('gateway/bad-request', 'Workspace is unavailable.', {})
    return brandString<KnowledgeSpace>(createHash('sha256').update(workspace.path).digest('hex'))
  }

  private async perform<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() } catch (error) {
      if (error instanceof KnowledgeError) {
        throw new RemoteError('knowledge/operation-failed', error.message, { reason: error.code }, { cause: error })
      }
      throw error
    }
  }

  /**
   * Read one authorized workspace's document page and source-derived graph.
   * @param workspaceId - Existing workspace whose documents the caller may read.
   * @param query - Optional full-text query.
   * @param offset - Non-negative header offset when the query is empty.
   * @param signal - Caller cancellation.
   * @returns Document counts, bounded metadata, source matches, and keyword associations.
   */
  @Remote({ resources: { workspace: (workspaceId: WorkspaceId) => workspaceId } })
  dashboard(workspaceId: WorkspaceId, query: string, offset: number, signal: AbortSignal): Promise<KnowledgeDashboard> {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new RemoteError('gateway/bad-request', 'Offset must be non-negative.', {})
    const space = this.space(workspaceId)
    return this.perform(() => this.ctx.knowledgeBase.dashboard(space, query, offset, signal))
  }

  /**
   * Import a browser-selected document into one authorized workspace's index.
   * @param workspaceId - Existing workspace whose knowledge the caller may update.
   * @param filename - Plain source filename.
   * @param base64 - Complete canonical base64 content.
   * @param replace - Explicit user confirmation for replacing an existing uploaded filename.
   * @param signal - Caller cancellation.
   * @returns The published document identity and revision.
   */
  @Remote({ resources: { workspace: (workspaceId: WorkspaceId) => workspaceId } })
  upload(workspaceId: WorkspaceId, filename: string, base64: string, replace: boolean, signal: AbortSignal): Promise<KnowledgeDocument> {
    const space = this.space(workspaceId)
    return this.perform(() => this.ctx.knowledgeBase.importUploaded(space, filename, base64, replace, signal))
  }

  /**
   * Read an exact imported passage for one authorized workspace.
   * @param workspaceId - Existing workspace whose document the caller may read.
   * @param documentId - Imported document identity.
   * @param chunk - Non-negative zero-based passage number.
   * @param version - Exact imported revision from the document metadata.
   * @param signal - Caller cancellation.
   * @returns Source text and its original page or line location.
   */
  @Remote({ resources: { workspace: (workspaceId: WorkspaceId) => workspaceId } })
  read(
    workspaceId: WorkspaceId, documentId: KnowledgeDocumentId, chunk: number, version: string, signal: AbortSignal,
  ): Promise<KnowledgePassage> {
    if (!Number.isSafeInteger(chunk) || chunk < 0) throw new RemoteError('gateway/bad-request', 'Passage must be non-negative.', {})
    const space = this.space(workspaceId)
    return this.perform(() => this.ctx.knowledgeBase.read(space, documentId, chunk, version, signal))
  }

  /**
   * Remove an authorized workspace's indexed document while retaining its original file.
   * @param workspaceId - Existing workspace whose knowledge the caller may update.
   * @param documentId - Document confirmed by the user.
   * @param signal - Caller cancellation before the delete transaction.
   * @returns The removed document identity; repeated removal is safe.
   */
  @Remote({ resources: { workspace: (workspaceId: WorkspaceId) => workspaceId } })
  deleteDocument(workspaceId: WorkspaceId, documentId: KnowledgeDocumentId, signal: AbortSignal): Promise<KnowledgeRemoval> {
    const space = this.space(workspaceId)
    return this.perform(() => this.ctx.knowledgeBase.remove(space, documentId, signal))
  }
}
