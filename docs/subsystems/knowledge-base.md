# Document knowledge

English | [中文](knowledge-base.zh.md)

The optional [knowledge-base package](../../packages/experimental/knowledge-base/README.md) stores imported reference passages independently of personal memory. Native tools derive access from the calling Session's original workspace. Trusted service consumers must supply only workspace identities they are authorized to access.

## Identities and results

`KnowledgeSpace` identifies the original workspace; `KnowledgeDocumentId` identifies a canonical source inside that workspace. Both are branded strings. A document's `version` is the SHA-256 digest of its imported bytes, so an exact-revision read rejects after replacement.

| Type | Fields and meaning |
|---|---|
| `KnowledgeDocument` | `documentId`, canonical `source`, display `title`, content `version`, and total `chunks` |
| `KnowledgePassage` | Document metadata plus zero-based `chunk`, exact `text`, and either a 1-based PDF `page` or `startLine`/`endLine`; unavailable locations are null |
| `KnowledgeSearch` | Actual `mode` (`keyword` or `hybrid`) and bounded `passages` |
| `KnowledgeDocumentList` | Bounded `documents` and `nextOffset`, or null when exhausted; offsets require an unchanged collection |
| `KnowledgeRemoval` | Removed `documentId` and `removed: true`, including when already absent |
| `KnowledgeDashboard` | Workspace totals, bounded document metadata and source matches, graph nodes/edges, pagination, sampling indicator, and upload byte limit |
| `KnowledgeGraphNode` / `KnowledgeGraphEdge` | Branded document or keyword nodes and observed document-to-keyword occurrence counts |

Definitions: [knowledge result types](../../packages/experimental/knowledge-base/src/types.ts). Operational limits, supported sources, embedding configuration, failure guarantees, and model-visible behavior belong to the [package reference](../../packages/experimental/knowledge-base/README.md).

## Cordis API

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxknowledgebase--knowledgebase"></a>

### `ctx.knowledgeBase` — `KnowledgeBase`

A workspace-scoped document index with replaceable source snapshots and native tools.

```ts cordis-catalog
/**
 * Read a size-bounded file through the configured filesystem and import its snapshot.
 * @param space - Authorized original workspace; trusted callers derive it from Session ownership.
 * @param path - Source file to import.
 * @param cwd - Execution-world directory for relative paths.
 * @param signal - Cancellation for file reads and indexing preparation.
 * @returns Document ID, content revision, and passage count after atomic publication.
 */
async importDocument(space: KnowledgeSpace, path: string, cwd: string, signal: AbortSignal): Promise<KnowledgeDocument>

/**
 * Search reference passages within one authorized original workspace.
 * @param space - Caller-owned workspace identity.
 * @param query - Natural-language query.
 * @param limit - Maximum requested passages.
 * @param signal - Cancellation for embedding and result delivery.
 * @returns Bounded passages with source locations and revisions.
 */
search(space: KnowledgeSpace, query: string, limit: number, signal: AbortSignal): Promise<KnowledgeSearch>

/**
 * Read a passage from an exact imported revision; source files are not reread.
 * @param space - Caller-owned workspace identity.
 * @param id - Imported document ID.
 * @param chunk - Zero-based passage number.
 * @param version - Exact imported content revision.
 * @param signal - Cancellation for result delivery.
 * @returns Indexed source text with its original page or line range.
 */
read(space: KnowledgeSpace, id: KnowledgeDocumentId, chunk: number, version: string, signal: AbortSignal): Promise<KnowledgePassage>

/**
 * List imported document metadata in the authorized workspace.
 * @param space - Caller-owned workspace identity.
 * @param offset - Header offset from a previous page, or zero.
 * @param limit - Requested document count.
 * @param signal - Cancellation for result delivery.
 * @returns Bounded metadata and the next offset when more documents exist.
 */
list(space: KnowledgeSpace, offset: number, limit: number, signal: AbortSignal): Promise<KnowledgeDocumentList>

/**
 * Remove indexed passages while retaining original files and memory records.
 * @param space - Caller-owned workspace identity.
 * @param id - Document confirmed by the user.
 * @param signal - Cancellation observed before the delete transaction.
 * @returns Removed document identity; repeated removal is safe.
 */
remove(space: KnowledgeSpace, id: KnowledgeDocumentId, signal: AbortSignal): Promise<KnowledgeRemoval>

/**
 * Import a browser-selected source without writing into the user's workspace.
 * @param space - Authorized original workspace identity.
 * @param name - Plain filename of the selected document.
 * @param base64 - Canonical base64 source bytes, bounded before decoding.
 * @param replace - Explicit confirmation that an existing uploaded filename may be updated.
 * @param signal - Cancellation before atomic publication.
 * @returns The imported snapshot; uploading the same filename replaces its uploaded revision.
 */
importUploaded( space: KnowledgeSpace, name: string, base64: string, replace: boolean, signal: AbortSignal, ): Promise<KnowledgeDocument>

/**
 * Read document metadata, source matches, and literal keyword associations.
 * @param space - Authorized original workspace identity.
 * @param query - Optional source-text query.
 * @param offset - Header offset when query is empty.
 * @param signal - Cancellation for source retrieval and optional embeddings.
 * @returns A bounded management snapshot with source-derived graph nodes and links.
 */
dashboard(space: KnowledgeSpace, query: string, offset: number, signal: AbortSignal): Promise<KnowledgeDashboard>
```

Source: [`packages/experimental/knowledge-base/src/index.ts`](../../packages/experimental/knowledge-base/src/index.ts)

<a id="ctxknowledgecontroller--knowledgecontroller"></a>

### `ctx.knowledgeController` — `KnowledgeController`

One Remote namespace for knowledge management, without changing the Agent tools.

```ts cordis-catalog
/**
 * Read one authorized workspace's document page and source-derived graph.
 * @param workspaceId - Existing workspace whose documents the caller may read.
 * @param query - Optional full-text query.
 * @param offset - Non-negative header offset when the query is empty.
 * @param signal - Caller cancellation.
 * @returns Document counts, bounded metadata, source matches, and keyword associations.
 */
@Remote({ resources: { workspace: (workspaceId: WorkspaceId) => workspaceId } }) dashboard(workspaceId: WorkspaceId, query: string, offset: number, signal: AbortSignal): Promise<KnowledgeDashboard>

/**
 * Import a browser-selected document into one authorized workspace's index.
 * @param workspaceId - Existing workspace whose knowledge the caller may update.
 * @param filename - Plain source filename.
 * @param base64 - Complete canonical base64 content.
 * @param replace - Explicit user confirmation for replacing an existing uploaded filename.
 * @param signal - Caller cancellation.
 * @returns The published document identity and revision.
 */
@Remote({ resources: { workspace: (workspaceId: WorkspaceId) => workspaceId } }) upload(workspaceId: WorkspaceId, filename: string, base64: string, replace: boolean, signal: AbortSignal): Promise<KnowledgeDocument>

/**
 * Read an exact imported passage for one authorized workspace.
 * @param workspaceId - Existing workspace whose document the caller may read.
 * @param documentId - Imported document identity.
 * @param chunk - Non-negative zero-based passage number.
 * @param version - Exact imported revision from the document metadata.
 * @param signal - Caller cancellation.
 * @returns Source text and its original page or line location.
 */
@Remote({ resources: { workspace: (workspaceId: WorkspaceId) => workspaceId } }) read( workspaceId: WorkspaceId, documentId: KnowledgeDocumentId, chunk: number, version: string, signal: AbortSignal, ): Promise<KnowledgePassage>

/**
 * Remove an authorized workspace's indexed document while retaining its original file.
 * @param workspaceId - Existing workspace whose knowledge the caller may update.
 * @param documentId - Document confirmed by the user.
 * @param signal - Caller cancellation before the delete transaction.
 * @returns The removed document identity; repeated removal is safe.
 */
@Remote({ resources: { workspace: (workspaceId: WorkspaceId) => workspaceId } }) deleteDocument(workspaceId: WorkspaceId, documentId: KnowledgeDocumentId, signal: AbortSignal): Promise<KnowledgeRemoval>
```

Types: [WorkspaceId](workspace.md)

Source: [`packages/experimental/knowledge-base/src/controller.ts`](../../packages/experimental/knowledge-base/src/controller.ts)
<!-- END GENERATED cordis-surface -->
