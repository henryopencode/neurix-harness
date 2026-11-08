# 文档知识库

[English](knowledge-base.md) | 中文

可选的 [knowledge-base 包](../../packages/core/knowledge-base/README.zh.md)将导入的参考片段与个人记忆分开保存。原生工具依据调用方 Session 的原始工作区限制访问。可信服务消费者只能提供其有权访问的工作区标识。

## 标识与结果

`KnowledgeSpace` 标识原始工作区；`KnowledgeDocumentId` 标识该工作区内的规范来源。两者均为带品牌的字符串。文档的 `version` 是导入字节的 SHA-256 摘要，因此文档被替换后，精确版本读取会拒绝。

| 类型 | 字段与含义 |
|---|---|
| `KnowledgeDocument` | `documentId`、规范 `source`、展示 `title`、内容 `version` 和总片段数 `chunks` |
| `KnowledgePassage` | 文档元数据加从零编号的 `chunk`、精确 `text`，以及从一编号的 PDF `page` 或 `startLine`/`endLine`；无对应位置的字段为 null |
| `KnowledgeSearch` | 实际 `mode`（`keyword` 或 `hybrid`）和有界 `passages` |
| `KnowledgeDocumentList` | 有界 `documents` 和 `nextOffset`，无后续条目时为 null；偏移要求集合不变 |
| `KnowledgeRemoval` | 被移除的 `documentId` 和 `removed: true`，已不存在的文档也返回此结果 |
| `KnowledgeDashboard` | `availability`（`ready` 或 `unsupported-platform`）、工作区总数、有界文档元数据和原文匹配、图谱节点与边、分页、采样标记及上传字节限制 |
| `KnowledgeGraphNode` / `KnowledgeGraphEdge` | 带品牌的文档或关键词节点，以及观测到的文档与关键词共现次数 |

类型定义见[知识库结果类型](../../packages/core/knowledge-base/src/types.ts)。操作限制、支持格式、embedding 配置、失败保证和模型可见行为由[包参考](../../packages/core/knowledge-base/README.zh.md)负责。

## Cordis API

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Source: [`packages/core/knowledge-base/src/index.ts`](../../packages/core/knowledge-base/src/index.ts)

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

Types: [WorkspaceId](workspace.zh.md)

Source: [`packages/core/knowledge-base/src/controller.ts`](../../packages/core/knowledge-base/src/controller.ts)
<!-- END GENERATED cordis-surface -->
