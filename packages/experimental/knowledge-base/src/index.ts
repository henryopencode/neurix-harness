/** Local document knowledge, supplied to Agents through native Cordis tools. */

import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-working-directory'
import { Config, resolveConfig } from './config.ts'
import { KnowledgeIndex } from './engine.ts'
import { registerTools } from './tools.ts'
import { KnowledgeController } from './controller.ts'
import { KnowledgeError } from './errors.ts'
import type { KnowledgeDashboard, KnowledgeDocument, KnowledgeDocumentId, KnowledgeDocumentList, KnowledgePassage, KnowledgeRemoval, KnowledgeSearch, KnowledgeSpace } from './types.ts'

export { KnowledgeError } from './errors.ts'
export { KnowledgeController } from './controller.ts'
export type { Config } from './config.ts'
export type { KnowledgeDashboard, KnowledgeDocument, KnowledgeDocumentId, KnowledgeDocumentList, KnowledgeGraphNode, KnowledgeGraphNodeId, KnowledgeGraphEdge, KnowledgePassage, KnowledgeRemoval, KnowledgeSearch, KnowledgeSpace } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeBase: KnowledgeBase
  }
}

/** A workspace-scoped document index with replaceable source snapshots and native tools. */
export default class KnowledgeBase extends Service {
  static inject = ['tools', 'fs', 'workingDirectory']
  static Config = Config
  private readonly index: KnowledgeIndex

  constructor(ctx: Context, config: Config) {
    super(ctx, 'knowledgeBase')
    this.index = new KnowledgeIndex(resolveConfig(config))
  }

  protected async [Service.init](): Promise<void> {
    await this.index.open()
    this.ctx.effect(() => () => this.index.close())
    registerTools(this.ctx, this, this.index.config)
    this.ctx.inject(['typert', 'remoteAccess', 'workspaceRegistry', 'workspaceController'], (ctx) => {
      ctx.plugin(KnowledgeController)
    })
  }

  /**
   * Read a size-bounded file through the configured filesystem and import its snapshot.
   * @param space - Authorized original workspace; trusted callers derive it from Session ownership.
   * @param path - Source file to import.
   * @param cwd - Execution-world directory for relative paths.
   * @param signal - Cancellation for file reads and indexing preparation.
   * @returns Document ID, content revision, and passage count after atomic publication.
   */
  async importDocument(space: KnowledgeSpace, path: string, cwd: string, signal: AbortSignal): Promise<KnowledgeDocument> {
    return this.index.import(space, async (active) => {
      const target = await this.ctx.fs.resolve(path, { cwd, signal: active })
      const bytes = await this.ctx.fs.readBytes(target, active, this.index.config.maxFileBytes)
      return { source: this.ctx.fs.processPath(target), bytes }
    }, signal)
  }

  /**
   * Search reference passages within one authorized original workspace.
   * @param space - Caller-owned workspace identity.
   * @param query - Natural-language query.
   * @param limit - Maximum requested passages.
   * @param signal - Cancellation for embedding and result delivery.
   * @returns Bounded passages with source locations and revisions.
   */
  search(space: KnowledgeSpace, query: string, limit: number, signal: AbortSignal): Promise<KnowledgeSearch> {
    return this.index.search(space, query, limit, signal)
  }

  /**
   * Read a passage from an exact imported revision; source files are not reread.
   * @param space - Caller-owned workspace identity.
   * @param id - Imported document ID.
   * @param chunk - Zero-based passage number.
   * @param version - Exact imported content revision.
   * @param signal - Cancellation for result delivery.
   * @returns Indexed source text with its original page or line range.
   */
  read(space: KnowledgeSpace, id: KnowledgeDocumentId, chunk: number, version: string, signal: AbortSignal): Promise<KnowledgePassage> {
    return this.index.read(space, id, chunk, version, signal)
  }

  /**
   * List imported document metadata in the authorized workspace.
   * @param space - Caller-owned workspace identity.
   * @param offset - Header offset from a previous page, or zero.
   * @param limit - Requested document count.
   * @param signal - Cancellation for result delivery.
   * @returns Bounded metadata and the next offset when more documents exist.
   */
  list(space: KnowledgeSpace, offset: number, limit: number, signal: AbortSignal): Promise<KnowledgeDocumentList> {
    return this.index.list(space, offset, limit, signal)
  }

  /**
   * Remove indexed passages while retaining original files and memory records.
   * @param space - Caller-owned workspace identity.
   * @param id - Document confirmed by the user.
   * @param signal - Cancellation observed before the delete transaction.
   * @returns Removed document identity; repeated removal is safe.
   */
  remove(space: KnowledgeSpace, id: KnowledgeDocumentId, signal: AbortSignal): Promise<KnowledgeRemoval> {
    return this.index.remove(space, id, signal)
  }

  /**
   * Import a browser-selected source without writing into the user's workspace.
   * @param space - Authorized original workspace identity.
   * @param name - Plain filename of the selected document.
   * @param base64 - Canonical base64 source bytes, bounded before decoding.
   * @param replace - Explicit confirmation that an existing uploaded filename may be updated.
   * @param signal - Cancellation before atomic publication.
   * @returns The imported snapshot; uploading the same filename replaces its uploaded revision.
   */
  importUploaded(
    space: KnowledgeSpace, name: string, base64: string, replace: boolean, signal: AbortSignal,
  ): Promise<KnowledgeDocument> {
    return this.index.import(space, () => {
      if (!name.trim() || name !== name.trim() || /[/\\\u0000-\u001f]/u.test(name) || !name.isWellFormed()) {
        throw new KnowledgeError('Select a file with a valid plain filename.', 'KNOWLEDGE_INVALID_INPUT')
      }
      if (base64.length > 4 * Math.ceil(this.index.config.maxFileBytes / 3)) {
        throw new KnowledgeError('Source exceeds the configured file byte limit.', 'KNOWLEDGE_TOO_LARGE')
      }
      const bytes = Buffer.from(base64, 'base64')
      if (bytes.toString('base64') !== base64) throw new KnowledgeError('Upload encoding is invalid.', 'KNOWLEDGE_INVALID_INPUT')
      const filename = name.normalize('NFC')
      return Promise.resolve({ source: `knowledge-upload://${encodeURIComponent(filename)}`, title: filename, bytes })
    }, signal, replace)
  }

  /**
   * Read document metadata, source matches, and literal keyword associations.
   * @param space - Authorized original workspace identity.
   * @param query - Optional source-text query.
   * @param offset - Header offset when query is empty.
   * @param signal - Cancellation for source retrieval and optional embeddings.
   * @returns A bounded management snapshot with source-derived graph nodes and links.
   */
  dashboard(space: KnowledgeSpace, query: string, offset: number, signal: AbortSignal): Promise<KnowledgeDashboard> {
    return this.index.dashboard(space, query, offset, signal)
  }
}
