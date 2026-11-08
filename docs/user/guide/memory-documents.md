# Remember project knowledge with documents and images

English | [中文](memory-documents.zh.md)

## Summary

Use `dsh-memory-documents` to keep project knowledge in searchable Markdown with independent image copies. New sessions can retrieve a short summary, open the relevant document, and read its pictures when needed. Simple preferences can stay in a [memory MCP provider](mcp-memory.md); documents hold the detailed explanation and visual references.

## Table of contents

- [Make the skill available](#make-the-skill-available)
- [Save and recall knowledge](#save-and-recall-knowledge)
- [Storage and maintenance](#storage-and-maintenance)

<a id="make-the-skill-available"></a>
## Make the skill available

The [skill directory](../../../.agents/skills/dsh-memory-documents/SKILL.md) is discovered by Neurix's default filesystem skill provider when working in this source repository. To use it in other projects, copy the complete `dsh-memory-documents` directory, including `scripts/`, into `$DSH_HOME/skills/` (`~/.dsh/skills/` by default), or a project's `.dsh/skills/`. The [skill provider](../../../packages/skill/skill-filesystem/README.md) must be mounted. The helper uses Node and has no npm dependencies.

Confirm that the skill catalog contains `dsh-memory-documents`. Invoke it by name if the model does not select it. This workflow guides tool use; it does not guarantee retrieval on every model turn or silently import previous conversations. The skill and its helper must be accessible in the agent's filesystem and shell environment, including remote execution environments.

<a id="save-and-recall-knowledge"></a>
## Save and recall knowledge

Ask the agent: “Use dsh-memory-documents to remember this homepage reference image and the layout requirements I confirmed.” Supply the image and describe which details matter; an upload must expose a readable file path in the agent's execution environment before it can be copied. The agent saves one topic with a summary, searchable tags, Markdown, and captioned image copies; the captions explain what future sessions should recover from each image.

In a new session for the same project, ask: “Use dsh-memory-documents to find the homepage reference and use its layout.” The agent searches summaries and content, opens the current document, and calls `read_image` when the visual detail matters. Reading an image requires an image-capable model route and the normal file-reading tools; text-only routes can use the written description but cannot inspect the picture.

To change knowledge, ask the agent to update its existing topic. Updates require the revision returned by the latest read, so a concurrent change is reported instead of overwritten. Ask to archive an obsolete topic to exclude it from ordinary search while retaining its document and attachments. Search uses case-insensitive keywords, including captions; it does not use embeddings or infer semantic equivalents.

When an existing memory MCP provider is available, the agent can also save a brief summary and document path there. The document remains the detailed record. The helper does not write to third-party providers itself; successful document persistence and a provider update are separate outcomes.

<a id="storage-and-maintenance"></a>
## Storage and maintenance

The default store is `.dsh/memory/` under the nearest ancestor with `.git`, or the current directory when none exists. Sessions using that same project directory share the store; separate Git worktrees have separate stores. A consistent explicit absolute `--root` can select a shared directory accessible to the agent. These project files are separate from the Session log and should be included in project-data backups. This repository ignores its `.dsh/memory/` directory to keep remembered material out of commits.

Each document has JSON frontmatter between `---` delimiters and a generated image section. Markdown is authoritative; `INDEX.md` is a generated navigation aid. Search scans the documents directly, so manual edits are visible immediately. Preserve the metadata and image-section marker, then run `reindex` to refresh navigation. See the [skill instructions](../../../.agents/skills/dsh-memory-documents/SKILL.md) for the JSON input and commands.

From this source repository, initialize an empty store or rebuild its index with:

```sh
node .agents/skills/dsh-memory-documents/scripts/memory-documents.mjs init
node .agents/skills/dsh-memory-documents/scripts/memory-documents.mjs reindex
```

PNG, JPEG, WebP, and GIF attachments are copied by content hash before a document is published. The helper checks signatures and defaults to 20 MiB per image; `--max-image-bytes` changes that bound. `read_image` owns image decoding and the deployment's independent image limits. Original reference files can be removed after a successful save. A failed save can leave an unused copied asset; automatic attachment cleanup is not provided.

Failures exit nonzero with a JSON error. `REVISION_CONFLICT` requires another read. `BUSY` identifies the writer lock; confirm that its recorded process has stopped before removing a leftover lock. `INDEX_UPDATE_FAILED` explicitly reports that the document is committed: repair the cause and run `reindex`. Missing or malformed documents and missing attachments are reported rather than silently omitted.
