---
description: "会话历史检索、搜索、关系追踪、日志导出与本地错误诊断的包映射。"
kind: "package-group"
---

# session-query/：会话检索能力家族

[English](README.md) | 中文

## 概述

独立于压缩（compaction）查询实时与持久会话历史：读取精确日志、筛选会话、追踪关系并搜索文本。通过 Web `/export` 命令导出会话 ZIP，或在设置中检查分组错误并预览本地诊断 ZIP。搜索使用模型可见的对话历史；诊断使用有数量和长度上限的派生记录，而非完整日志。本页概述该组；各包 README 分别说明其配置与限制。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

每个包的 README 都会说明该包在此组中的用途。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`session-query/`](session-query/README.zh.md) | 统一的会话历史查询服务：精确读取、关系追踪与过滤 | `ctx.sessionQuery` |
| [`session-query-sqlite/`](session-query-sqlite/README.zh.md) | 基于 SQLite FTS5 索引的会话历史全文搜索 | 注册到 `ctx.sessionQuery` |
| [`session-log-export/`](session-log-export/README.zh.md) | Web `/export` 命令与浏览器下载会话 ZIP | `ctx.sessionLogDownload`（浏览器） |
| [`session-diagnostics/`](session-diagnostics/README.zh.md) | 设置中的错误分组、显式历史索引与经预览的本地诊断 ZIP | `ctx.sessionDiagnostics` |

-----

<a id="related-documentation"></a>
## 相关文档

先从子系统参考了解共享的查询词汇，再看追踪与搜索背后的设计记录。

默认 Web 和 Desktop 使用这套共享查询、索引、导出与诊断基础设施。[实验性面向模型工具](../experimental/tool-session-query/README.zh.md)是独立的可选消费方。

- [会话查询子系统参考](../../docs/subsystems/session-query.zh.md)——逻辑记录、过滤器、搜索页、血缘、有界读取与事件关系。
- [会话查询关系追踪](../../.agents/notes/archived/feature/2026-07-13-session-query-tracing.md)——追踪语义与校验边界。
- [SQLite FTS5 会话搜索](../../.agents/notes/archived/feature/2026-07-10-sqlite-session-query-provider.md)——搜索语义、对账与 tokenizer 决策。

<a id="dev-note"></a>
## 开发备注

无。
