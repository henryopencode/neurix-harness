---
description: "Package map for Session history retrieval, search, relationship tracing, log export, and local error diagnostics."
kind: "package-group"
---

# session-query/ — session retrieval capability family

English | [中文](README.zh.md)

## Summary

Query live and durable Session history independently of compaction: retrieve exact logs, filter Sessions, trace relationships, and search text. Export a Session ZIP through the Web `/export` command, or inspect grouped failures and preview a local diagnostic ZIP in Settings. Search uses the conversation history visible to the model; diagnostics use bounded derived records rather than complete logs. This page maps the group; each package README owns its configuration and limitations.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Each package README describes what you can do with its part of the family.

| Package | Role | ctx key |
|---|---|---|
| [`session-query/`](session-query/README.md) | Unified session-history query service: exact reads, relationship traces, and filters | `ctx.sessionQuery` |
| [`session-query-sqlite/`](session-query-sqlite/README.md) | Full-text search across session history backed by a SQLite FTS5 index | registers on `ctx.sessionQuery` |
| [`session-log-export/`](session-log-export/README.md) | Web `/export` command and browser download of a session ZIP | `ctx.sessionLogDownload` (browser) |
| [`session-diagnostics/`](session-diagnostics/README.md) | Settings error groups, explicit historical indexing, and previewed local diagnostic ZIPs | `ctx.sessionDiagnostics` |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem reference for the shared query vocabulary, then the design records behind tracing and search.

The default Web and Desktop use this shared query, index, export, and diagnostics infrastructure. The [experimental model-facing tools](../experimental/tool-session-query/README.md) are a separate optional consumer.

- [Session Query subsystem reference](../../docs/subsystems/session-query.md) — logical records, filters, search pages, lineage, bounded reads, and event relationships.
- [Session query relationship tracing](../../.agents/notes/archived/feature/2026-07-13-session-query-tracing.md) — trace semantics and the validation boundary.
- [SQLite FTS5 session search](../../.agents/notes/archived/feature/2026-07-10-sqlite-session-query-provider.md) — search semantics, reconciliation, and the tokenizer decision.

<a id="dev-note"></a>
## Dev Note

None.
