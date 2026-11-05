# Add document knowledge

English | [中文](knowledge-base.zh.md)

Query reference manuals and project documents across sessions while your existing memory system retains personal preferences and decisions.

## Enable knowledge management

In Web and Desktop, open **Knowledge base** directly in the sidebar. It is built in and enabled by default. Open its sidebar entry to import and manage workspace documents. The index stays on this machine; the memory system continues to manage preferences separately.

### Source-checkout example

Build the checkout and use Node 24.9 or later on a supported LanceDB architecture: Apple Silicon macOS, Linux, or Windows. Apple Silicon requires ARM Node rather than Intel Node under Rosetta.

```sh
pnpm dsh web --patch "$PWD/apps/cli/config/examples/knowledge-base.cordis.yml" --no-open --port 0
```

Open the printed URL and choose a workspace. The example stores its index under `$DSH_HOME/storages/knowledge-base`. Open **Knowledge base** in the sidebar to import and manage documents. The existing memory page manages personal preferences separately.

## Import and ask

Put a Markdown, UTF-8 TXT, or text PDF file in the selected workspace. Ask the Agent to import that file, then ask a question about it and request source citations. Later sessions in the same original workspace can retrieve the imported document; sessions in another workspace cannot.

The Agent uses `knowledge_import`, `knowledge_search`, `knowledge_read`, `knowledge_list`, and `knowledge_remove`. Ask it to reimport a modified source, list references, or remove an imported document. Removal retains the source file and personal memories. Source changes require reimporting; deleting the source does not delete its indexed snapshot.

## Manage documents and explore associations

Choose the workspace in the knowledge page, then import a Markdown, TXT, or text PDF file. Select a document node or its list entry to read the imported text with its original page or line range. Select a keyword to filter the associated documents. Search checks document content; graph zoom and pan help inspect the current page.

A same-name upload asks before updating the imported revision. Removing a document asks for confirmation and affects only that workspace’s index. The graph shows literal document/keyword associations from bounded samples; it does not assert semantic relationships.

## Optional semantic retrieval

The example uses local keyword retrieval without credentials. An existing Ollama embedding server and model can enable semantic and keyword retrieval together; the [package reference](../../../packages/core/knowledge-base/README.md#retrieval-and-limits) defines configuration and reindexing requirements. Passages are sent to the embedding endpoint only when you explicitly configure it.
