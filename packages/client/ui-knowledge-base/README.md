---
description: "Manage workspace knowledge documents, inspect source passages, and explore document/keyword associations from the sidebar."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-knowledge-base

English | [中文](README.zh.md)

## Summary

Import and manage reference documents from a dedicated sidebar page. Explore their literal keyword associations, search their contents, and read the original passage with its page or line range. Each workspace keeps its own collection, separate from personal memory.

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

The Web bundle mounts this built-in page alongside [document knowledge](../../core/knowledge-base/README.md) in a Web or Desktop composition providing the Workspace controller, typed Gateway, and standard Client services. No plugin activation is required.

```yaml
- name: '@deepseek-ai/dsh-knowledge-base'
  config:
    path: /absolute/path/to/knowledge-index
- name: '@deepseek-ai/dsh-client-ui-knowledge-base'
```

Open **Knowledge base**, select a workspace, and import Markdown, TXT, or text PDF. A document node opens its exact imported source; a keyword filters associated documents. Search operates on document content. The graph supports pan, zoom, and view reset, with the document list below it on narrow screens.

Uploading the same normalized filename asks before replacing its imported revision. Removal also requires confirmation and retains the original file. Operations keep the workspace captured when the dialog opens. Failed requests appear in place or as a shell notice; an uncertain mutation outcome asks the user to refresh before retrying.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host authorizes every call against its Workspace resource and uses the same index as the native tools. Shared Client resources own dashboards and exact-revision passage reads. Feature state holds only selection intent, mutation progress, and notices. Mutation requests belong to one cancellable activation; disposal waits for them before withdrawing the generated Remote methods. D3 computes a stopped, deterministic layout without retaining background simulation timers.

Sources: [resource and sidebar bindings](src/client/mount.ts), [page](src/client/Page.tsx), [graph](src/client/Graph.tsx), and [mutation ownership](src/client/source.ts).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [User guide](../../../docs/user/guide/knowledge-base.md) — enable the example and import documents.
- [Knowledge package](../../core/knowledge-base/README.md) — indexing, retrieval, budgets, and failures.
- [Knowledge API](../../../docs/subsystems/knowledge-base.md) — workspace-authorized management results.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through later [knowledge tool results](../../core/knowledge-base/README.md#model-experience) after documents are imported, replaced, or removed; this UI contributes no model prompt or tool schema.

#### KV Cache effect

Management reads do not alter Session history. A document update affects later retrieved results; previously logged source passages retain their original text.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The graph shows observed document/keyword co-occurrence from bounded leading passages, without inferring entities or semantic facts. Pagination and search can show only part of a collection.
- Imports accept one file at a time. Source synchronization, OCR, and directory watching follow the Host package's limitations.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
