---
description: "Workspace document knowledge for deployments importing local Markdown, TXT, and PDF references with native tools, source citations, and optional Ollama embeddings."
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-base

English | [中文](README.zh.md)

## Summary

Import reference documents and retrieve their original passages across sessions in the same workspace. Searches work locally without a model or API key; an explicit Ollama embedding target enables hybrid retrieval. Every passage retains its source file, imported revision, and page or line location. Personal preferences and decisions remain in the separate memory system.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Knowledge is mounted by the base-backed profiles. Web and Desktop show its sidebar management page immediately; the Plugins page has no enable/disable switch. The index remains under `$DSH_HOME/storages/knowledge-base`, and an empty collection imports no files automatically. Intel macOS shows an explicit unsupported-platform status without loading the native binding. Custom compositions can mount this service when they provide `tools`, `fs`, and `workingDirectory`.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-knowledge-base'
  config:
    path: /absolute/path/to/knowledge-index
```

Ask the Agent to import a Markdown, UTF-8 TXT, or text PDF file, then ask a question about that reference. `knowledge_import` returns its document ID and revision. `knowledge_search` retrieves passages; `knowledge_read` reads a zero-based passage from an exact revision. `knowledge_list` lists document metadata and pagination offsets. `knowledge_remove` removes indexed passages when explicitly requested, retaining original files and personal memories.

The original Session workspace determines access. Changing the current working directory changes relative source-path resolution, but does not grant another workspace's documents. Reimporting the same canonical source atomically replaces its indexed revision, including obsolete tail passages. Source-file changes are visible only after reimport; stale revisions reject reads. Removing a source file does not remove its imported snapshot.

### Document management

In Web or Desktop compositions providing the Workspace controller and typed Gateway, the plugin also exposes workspace-authorized document management. The Web bundle mounts [the built-in UI package](../../client/ui-knowledge-base/README.md) to add a sidebar entry, browser file import, source reading, and a document/keyword graph. Uploaded filenames use a separate source identity; uploading the same name requires explicit replacement confirmation. The graph is derived from bounded source samples and records literal keyword co-occurrence, without inferring semantic facts.

<a id="retrieval-and-limits"></a>
### Retrieval and limits

The default retrieves Chinese and other text through a local ICU-tokenized full-text index. To enable hybrid retrieval, configure `embedding.baseUrl` and `embedding.model` for an Ollama embedding model already installed on that server. Imported passages and queries are sent to that configured endpoint. The plugin neither downloads a model nor selects a chat model for embeddings. Changing the embedding target requires a new index directory and reimporting documents.

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-knowledge-base) owns every field and default. File-byte, extracted-text, passage-count, search-count, and complete UTF-8 result limits are independently enforced. A single passage that cannot fit rejects visibly; search and list pages reduce their item counts to fit. Adjacent passages do not overlap, so repeated source text retains correct line citations; use `knowledge_read` for surrounding passages.

### Failures and recovery

Unsupported, empty, oversized, and cancelled sources reject before replacing a document. Scanned PDFs require OCR before import. Invalid model responses reject before publication. A native write failure reports `KNOWLEDGE_WRITE_UNKNOWN`: list and read the current revision before deciding whether to retry. Closing the plugin cancels admission and waits for owned file reads and index operations before releasing resources.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Cordis service, LanceDB provider, and native tool consumers share one package. The filesystem provider owns source reads and canonical paths. LangChain splits extracted text into bounded passages; LanceDB owns atomic document replacement, full-text search, and optional vector retrieval. A persisted format marker prevents incompatible embedding targets from sharing one index.

One operation queue owns source preparation, native operations, cancellation, and connection shutdown. Every query filters the caller's original workspace before applying result limits. Source text reaches the model through ordinary logged tool results, carrying its imported revision rather than a live source-file dependency.

- [Service and configuration](src/index.ts)
- [LanceDB indexing](src/engine.ts)
- [Source extraction and splitting](src/sources.ts)
- [Native tools and their schemas](src/tools.ts)

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Capability seams](../../../docs/architecture.md) — plugin composition and provider ownership.
- [Filesystem service](../../fs/fs/README.md) — execution-world source access.
- [Working directories](../../session/working-directory/README.md) — original workspace and current directory.

-----

<a id="model-experience"></a>
## Model Experience

### Native knowledge tools

#### What the model sees

The [five native tool schemas](src/tools.ts), including `knowledge_import` and `knowledge_search`, describe document import, search, exact-revision reads, listing, and removal. Results contain bounded JSON with source paths, document IDs, content revisions, and passage locations. Search and read descriptions classify source text as untrusted reference material and require citations. No document is automatically injected or converted into personal memory.

#### Token effect

Enabled tools contribute their schemas. Called operations add their bounded results to Session history; document bodies are included only in returned search or read passages. Keyword retrieval makes no model request; configured embedding calls send only source passages or queries to the selected server.

#### KV Cache effect

Tool results append to existing history. Enabling or disabling the plugin changes tool declarations and may invalidate request-prefix reuse. Changing indexed documents affects subsequent results, while already logged passages remain unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The following limits apply to the built-in implementation.

- Text PDFs only: OCR, office formats, website synchronization, and directory watching are unavailable.
- Native LanceDB requires a supported runtime architecture; the selected release supports Apple Silicon macOS, Linux, and Windows, and does not provide Intel macOS bindings.
- One running plugin owns each index directory. Document-list offsets assume the collection is unchanged between pages.
- Original workspace paths define tool access; this is not a multi-user authorization service. Trusted service callers own their workspace authorization.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
