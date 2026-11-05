/** Durable LanceDB passages; one queue owns writes, query preparation, and shutdown. */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connect, Index, type Connection, type Table } from '@lancedb/lancedb'
import { Field, FixedSizeList, Float32, Int32, Schema, Utf8 } from 'apache-arrow'
import { OllamaEmbeddings } from '@langchain/ollama'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { KnowledgeError } from './errors.ts'
import { extractSource, splitSource } from './sources.ts'
import { buildKnowledgeGraph } from './graph.ts'
import type { KnowledgeConfig, KnowledgeDashboard, KnowledgeDocument, KnowledgeDocumentId, KnowledgeDocumentList, KnowledgePassage, KnowledgeRemoval, KnowledgeSearch, KnowledgeSpace } from './types.ts'

const rowSchema = z.object({
  id: z.string(), space: z.string(), documentId: z.string(), source: z.string(), title: z.string(), version: z.string(),
  chunks: z.number().int(), chunk: z.number().int(), text: z.string(),
  page: z.number().int().nullable(), startLine: z.number().int().nullable(), endLine: z.number().int().nullable(),
})
type Row = z.infer<typeof rowSchema>

function literal(value: string): string { return "'" + value.replaceAll("'", "''") + "'" }
function digest(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex') }
function document(row: Row): KnowledgeDocument {
  return {
    documentId: brandString<KnowledgeDocumentId>(row.documentId),
    source: row.source, title: row.title, version: row.version, chunks: row.chunks,
  }
}
function passage(row: Row): KnowledgePassage {
  return { ...document(row), chunk: row.chunk, text: row.text, page: row.page, startLine: row.startLine, endLine: row.endLine }
}
function schema(dimensions: number | undefined): Schema {
  return new Schema([
    ...['id', 'space', 'documentId', 'source', 'title', 'version', 'text'].map(name => new Field(name, new Utf8(), false)),
    ...['chunks', 'chunk'].map(name => new Field(name, new Int32(), false)),
    ...['page', 'startLine', 'endLine'].map(name => new Field(name, new Int32(), true)),
    ...dimensions === undefined ? [] : [new Field('vector', new FixedSizeList(dimensions, new Field('item', new Float32(), true)), false)],
  ])
}

/**
 * A local index whose document revisions are replaced in one LanceDB transaction.
 * Callers own workspace authorization; file bytes are supplied by the filesystem provider.
 */
export class KnowledgeIndex {
  private connection!: Connection
  private table: Table | undefined
  private tail: Promise<void> = Promise.resolve()
  private readonly lifetime = new AbortController()
  private closing: Promise<void> | undefined

  constructor(readonly config: KnowledgeConfig) {}

  /**
   * Validate persisted format and embedding identity before serving any caller.
   * @returns Resolves after the existing table is opened, or a fresh directory is initialized.
   */
  async open(): Promise<void> {
    await mkdir(this.config.path, { recursive: true, mode: 0o700 })
    const manifest = join(this.config.path, 'format.json')
    const expected = JSON.stringify({ version: 1, embedding: this.config.embedding ?? null })
    try { await writeFile(manifest, expected + '\n', { flag: 'wx', mode: 0o600 }) } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
      const stored: unknown = JSON.parse(await readFile(manifest, 'utf8'))
      if (JSON.stringify(stored) !== expected) {
        throw new KnowledgeError('Index format or embedding target differs. Use a new index directory and reimport the source files.', 'KNOWLEDGE_FORMAT_MISMATCH')
      }
    }
    this.connection = await connect(this.config.path)
    try {
      for await (const name of this.connection.listTables()) {
        if (name === 'passages') this.table = await this.connection.openTable(name)
      }
    } catch (error) {
      this.connection.close()
      throw error
    }
  }

  private run<T>(signal: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closing !== undefined) return Promise.reject(new KnowledgeError('Knowledge index is closed.', 'KNOWLEDGE_CLOSED'))
    const combined = AbortSignal.any([signal, this.lifetime.signal])
    const pending = this.tail.then(() => {
      combined.throwIfAborted()
      return operation(combined)
    })
    this.tail = pending.then(() => undefined, () => undefined)
    return pending
  }

  private embeddings(signal: AbortSignal): OllamaEmbeddings {
    if (this.config.embedding === undefined) throw new Error('knowledge-base: no embedding target')
    return new OllamaEmbeddings({
      ...this.config.embedding, maxRetries: 0,
      fetch: (url, init) => fetch(url, { ...init, signal }),
    })
  }

  private bounded<T>(value: T): T {
    if (Buffer.byteLength(JSON.stringify(value)) > this.config.maxResultBytes) {
      throw new KnowledgeError('Result exceeds the configured byte limit. Increase maxResultBytes or reduce the passage size.', 'KNOWLEDGE_TOO_LARGE')
    }
    return value
  }

  /**
   * Import one complete source snapshot; replacement removes obsolete passages atomically.
   * @param space - Authorized original workspace identity.
   * @param load - Read canonical source and bounded bytes under this operation's cancellation and lifetime.
   * @param signal - Cancellation; no commit starts after an observed cancellation.
   * @param replace - Whether an existing canonical source may be replaced; defaults to true for native imports.
   * @returns Imported document identity, content revision, and passage count.
   */
  import(
    space: KnowledgeSpace,
    load: (signal: AbortSignal) => Promise<{ source: string; bytes: Uint8Array; title?: string }>,
    signal: AbortSignal,
    replace = true,
  ): Promise<KnowledgeDocument> {
    return this.run(signal, async (active) => {
      const { source, bytes, title } = await load(active)
      active.throwIfAborted()
      if (bytes.byteLength > this.config.maxFileBytes) throw new KnowledgeError('Source exceeds the configured file byte limit.', 'KNOWLEDGE_TOO_LARGE')
      const documentId = brandString<KnowledgeDocumentId>(digest(source))
      if (!replace && this.table !== undefined
        && await this.table.countRows(`space = ${literal(space)} AND documentId = ${literal(documentId)}`) > 0) {
        throw new KnowledgeError('A document with this filename already exists. Confirm replacement before updating it.', 'KNOWLEDGE_ALREADY_EXISTS')
      }
      const pages = await extractSource(source, bytes, this.config.maxDocumentChars, active)
      const chunks = await splitSource(pages, this.config, active)
      const info = this.bounded({
        documentId, source, title: title ?? source.split(/[\\/]/u).at(-1) ?? source, version: digest(bytes), chunks: chunks.length,
      })
      const vectors = this.config.embedding === undefined
        ? undefined : await this.embeddings(active).embedDocuments(chunks.map(chunk => chunk.text))
      const dimensions = vectors?.[0]?.length
      if (vectors !== undefined && (vectors.length !== chunks.length || !dimensions
        || vectors.some(vector => vector.length !== dimensions || vector.some(value => !Number.isFinite(value))))) {
        throw new KnowledgeError('Embedding service returned inconsistent vectors; the previous document remains available.', 'KNOWLEDGE_INVALID_INPUT')
      }
      const rows = chunks.map((chunk, index) => ({
        ...info, ...chunk, chunk: index, space, id: digest(`${space}\0${documentId}\0${index}`),
        ...vectors?.[index] === undefined ? {} : { vector: vectors[index] },
      }))
      active.throwIfAborted()
      if (this.table === undefined) {
        this.table = await this.connection.createEmptyTable('passages', schema(vectors?.[0]?.length))
        await this.table.createIndex('text', { config: Index.fts({ baseTokenizer: 'icu', stem: false, removeStopWords: false }) })
      }
      active.throwIfAborted()
      try {
        await this.table.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll()
          .whenNotMatchedBySourceDelete({ where: `space = ${literal(space)} AND documentId = ${literal(documentId)}` }).execute(rows)
      } catch (error) {
        throw new KnowledgeError('Document update outcome is unknown. List and read its current version before retrying.', 'KNOWLEDGE_WRITE_UNKNOWN', { cause: error })
      }
      return info
    })
  }

  /**
   * Retrieve bounded passages through keyword search or configured hybrid retrieval.
   * @param space - Authorized workspace identity; filtering precedes result limits.
   * @param query - Natural-language text; it is not an FTS expression.
   * @param limit - Requested count, capped by the deployment limit.
   * @param signal - Cancellation for embeddings and result delivery.
   * @returns Source passages and the actual retrieval mode.
   */
  search(space: KnowledgeSpace, query: string, limit: number, signal: AbortSignal): Promise<KnowledgeSearch> {
    return this.run(signal, async (active) => {
      const mode = this.config.embedding === undefined ? 'keyword' : 'hybrid'
      if (!query.trim()) throw new KnowledgeError('Search query cannot be empty.', 'KNOWLEDGE_INVALID_INPUT')
      if (this.table === undefined) return { mode, passages: [] }
      const count = Math.min(limit, this.config.maxResults)
      const rows = await this.matches(space, query, count, active)
      active.throwIfAborted()
      const result: KnowledgeSearch = { mode, passages: rows.map(passage) }
      while (Buffer.byteLength(JSON.stringify(result)) > this.config.maxResultBytes && result.passages.length > 1) result.passages.pop()
      return this.bounded(result)
    })
  }

  private async matches(space: KnowledgeSpace, query: string, count: number, signal: AbortSignal): Promise<Row[]> {
    if (this.table === undefined) return []
    const search = this.config.embedding === undefined
      ? this.table.query() : this.table.vectorSearch(await this.embeddings(signal).embedQuery(query))
    const rows = await search.fullTextSearch(query, { columns: ['text'] })
      .where(`space = ${literal(space)}`).limit(count).toArray()
    return rows.map(row => rowSchema.parse(row))
  }

  /**
   * Read one bounded document page, its source-search passages, and observed keyword associations.
   * @param space - Authorized original workspace identity.
   * @param query - Optional source-text search; empty text lists document headers.
   * @param offset - Header offset for an unfiltered collection.
   * @param signal - Cancellation for query and optional embeddings.
   * @returns A consistent management snapshot from this index owner's operation queue.
   */
  dashboard(space: KnowledgeSpace, query: string, offset: number, signal: AbortSignal): Promise<KnowledgeDashboard> {
    return this.run(signal, async (active) => {
      const empty: KnowledgeDashboard = {
        totalDocuments: 0, totalPassages: 0, documents: [], passages: [], nodes: [], edges: [],
        nextOffset: null, truncated: false, pageSize: this.config.graphDocuments, maxFileBytes: this.config.maxFileBytes,
      }
      if (this.table === undefined) return empty
      const filter = `space = ${literal(space)}`
      const totalDocuments = await this.table.countRows(`${filter} AND chunk = 0`)
      const totalPassages = await this.table.countRows(filter)
      const limit = this.config.graphDocuments
      const searching = query.trim().length > 0
      const scanLimit = limit * this.config.graphChunksPerDocument
      const rows = searching ? await this.matches(space, query, scanLimit, active)
        : (await this.table.query().where(`${filter} AND chunk = 0`).offset(offset).limit(limit + 1)
          .select(Object.keys(rowSchema.shape)).toArray()).map(row => rowSchema.parse(row))
      const headers = new Map<string, KnowledgeDocument>()
      for (const row of rows) if (!headers.has(row.documentId)) headers.set(row.documentId, document(row))
      const documents = [...headers.values()].slice(0, limit)
      const ids = documents.map(item => literal(item.documentId)).join(', ')
      const samples = new Map<KnowledgeDocumentId, string>()
      if (ids.length > 0) {
        const sourceRows = await this.table.query()
          .where(`${filter} AND documentId IN (${ids}) AND chunk < ${this.config.graphChunksPerDocument}`)
          .select(['documentId', 'text']).limit(limit * this.config.graphChunksPerDocument).toArray()
        for (const sourceRow of sourceRows) {
          const row = rowSchema.pick({ documentId: true, text: true }).parse(sourceRow)
          const id = brandString<KnowledgeDocumentId>(row.documentId)
          samples.set(id, (samples.get(id) ?? '') + '\n' + row.text)
        }
      }
      active.throwIfAborted()
      const graph = buildKnowledgeGraph(documents, samples, this.config.graphKeywords, this.config.graphKeywordsPerDocument)
      const result: KnowledgeDashboard = {
        totalDocuments, totalPassages, documents,
        passages: searching ? rows.slice(0, this.config.maxResults).map(passage) : [],
        ...graph, nextOffset: !searching && rows.length > limit ? offset + limit : null,
        truncated: searching ? headers.size > limit || rows.length === scanLimit : totalDocuments > documents.length,
        pageSize: limit,
        maxFileBytes: this.config.maxFileBytes,
      }
      if (Buffer.byteLength(JSON.stringify(result)) > this.config.maxDashboardBytes) {
        throw new KnowledgeError('Management snapshot is too large. Narrow the search or reduce graphDocuments.', 'KNOWLEDGE_TOO_LARGE')
      }
      return result
    })
  }

  /**
   * Read one imported passage without accessing the current source file.
   * @param space - Authorized workspace identity.
   * @param id - Document returned by import, list, or search.
   * @param chunk - Zero-based passage number.
   * @param version - Required source revision; stale citations reject instead of reading a different revision.
   * @param signal - Cancellation for result delivery.
   * @returns Exact indexed passage with its source location and revision.
   */
  read(space: KnowledgeSpace, id: KnowledgeDocumentId, chunk: number, version: string, signal: AbortSignal): Promise<KnowledgePassage> {
    return this.run(signal, async (active) => {
      const rows = this.table === undefined ? [] : await this.table.query()
        .where(`space = ${literal(space)} AND documentId = ${literal(id)} AND chunk = ${chunk} AND version = ${literal(version)}`).limit(1).toArray()
      active.throwIfAborted()
      if (rows.length === 0) throw new KnowledgeError('Passage or revision is unavailable in this workspace. Search or list documents again.', 'KNOWLEDGE_NOT_FOUND')
      return this.bounded(passage(rowSchema.parse(rows[0])))
    })
  }

  /**
   * List document headers with offset pagination and a bounded complete result.
   * @param space - Authorized workspace identity.
   * @param offset - Number of document headers to skip.
   * @param limit - Requested header count, capped by the deployment limit.
   * @param signal - Cancellation for result delivery.
   * @returns Documents and the next offset, or null when no further headers exist.
   */
  list(space: KnowledgeSpace, offset: number, limit: number, signal: AbortSignal): Promise<KnowledgeDocumentList> {
    return this.run(signal, async (active) => {
      const count = Math.min(limit, this.config.maxResults)
      const rows = this.table === undefined ? [] : await this.table.query().where(`space = ${literal(space)} AND chunk = 0`).offset(offset).limit(count + 1).toArray()
      active.throwIfAborted()
      const result = {
        documents: rows.slice(0, count).map(row => document(rowSchema.parse(row))),
        nextOffset: rows.length > count ? offset + count : null,
      }
      while (Buffer.byteLength(JSON.stringify(result)) > this.config.maxResultBytes && result.documents.length > 1) {
        result.documents.pop()
        result.nextOffset = offset + result.documents.length
      }
      return this.bounded(result)
    })
  }

  /**
   * Remove a document's indexed passages; original files are untouched.
   * @param space - Authorized workspace identity.
   * @param id - Document identity confirmed by the user.
   * @param signal - Cancellation observed before the delete transaction starts.
   * @returns The removed document identity, including for an already absent document.
   */
  remove(space: KnowledgeSpace, id: KnowledgeDocumentId, signal: AbortSignal): Promise<KnowledgeRemoval> {
    return this.run(signal, async (active) => {
      active.throwIfAborted()
      if (this.table !== undefined) {
        try { await this.table.delete(`space = ${literal(space)} AND documentId = ${literal(id)}`) } catch (error) {
          throw new KnowledgeError('Document removal outcome is unknown. List documents before retrying.', 'KNOWLEDGE_WRITE_UNKNOWN', { cause: error })
        }
      }
      return { documentId: id, removed: true }
    })
  }

  /**
   * Stop admission, cancel cancellable work, and close native handles after operations settle.
   * @returns Resolves only after the connection and table are released.
   */
  close(): Promise<void> {
    return this.closing ??= (async () => {
      this.lifetime.abort(new KnowledgeError('Knowledge index is closing.', 'KNOWLEDGE_CLOSED'))
      await this.tail
      this.table?.close()
      this.connection.close()
    })()
  }
}
