# 用文档和图片记住项目知识

[English](memory-documents.md) | 中文

## 摘要

使用 `dsh-memory-documents`，把项目知识保存为可检索的 Markdown 和独立图片副本。新会话可以先检索简短摘要，再打开相关文档，并在需要时查看图片。简单偏好可以继续存入[记忆 MCP 提供方](mcp-memory.zh.md)；详细说明和视觉参考由文档保存。

## 目录

- [让技能可用](#make-the-skill-available)
- [保存和召回知识](#save-and-recall-knowledge)
- [存储和维护](#storage-and-maintenance)

<a id="make-the-skill-available"></a>
## 让技能可用

在本源码仓库中工作时，Neurix 默认的文件系统技能提供方会发现[技能目录](../../../.agents/skills/dsh-memory-documents/SKILL.md)。如需在其他项目使用，请把完整的 `dsh-memory-documents` 目录连同 `scripts/` 一起复制到 `$DSH_HOME/skills/`（默认 `~/.dsh/skills/`）或项目的 `.dsh/skills/`。[技能提供方](../../../packages/skill/skill-filesystem/README.zh.md)必须已挂载。辅助脚本使用 Node，无需 npm 依赖。

确认技能目录中出现 `dsh-memory-documents`。如果模型没有选择它，请按名称调用。该流程指导模型使用工具，不保证每个模型回合都会检索，也不会自动导入旧对话。在远程执行环境中，技能和辅助脚本同样必须能被 agent 的文件系统和 shell 环境访问。

<a id="save-and-recall-knowledge"></a>
## 保存和召回知识

向 agent 提出：“使用 dsh-memory-documents，记住这张首页参考图和我确认的布局要求。”提供图片并说明哪些细节需要保留；上传图片必须先在 agent 的执行环境中暴露可读取的文件路径，才能被复制。Agent 会按主题保存摘要、可搜索标签、Markdown 和带图注的图片副本；图注说明后续会话应从每张图中恢复哪些信息。

在同一项目的新会话中提出：“使用 dsh-memory-documents，找到首页参考图并沿用它的布局。”Agent 会检索摘要和正文、打开当前文档，并在视觉细节相关时调用 `read_image`。查看图片需要支持图片输入的模型路由和常规文件读取工具；纯文本路由可以使用文字说明，但无法检查图片。

需要修改知识时，让 agent 更新现有主题。更新必须携带最近一次读取返回的版本，因此并发修改会被报告，不会被覆盖。将过时主题归档后，普通搜索会排除它，但保留文档和附件。搜索使用不区分大小写的关键词，也检索图注；它不使用 embedding，也不推断语义相近的表达。

如果已有记忆 MCP 提供方可用，agent 还可以向其中保存简短摘要和文档路径。详细记录仍以文档为准。辅助脚本本身不写入第三方提供方；文档保存成功和提供方更新是两个独立结果。

<a id="storage-and-maintenance"></a>
## 存储和维护

默认存储位置为最近含 `.git` 的祖先目录下的 `.dsh/memory/`；没有该目录时使用当前目录。同一项目目录下的会话共享这份存储，不同 Git worktree 使用不同存储。持续传入同一个绝对 `--root` 可以选择 agent 可访问的共享目录。这些项目文件独立于 Session 日志，应纳入项目数据备份。本仓库忽略 `.dsh/memory/`，避免记忆内容进入提交。

每份文档包含位于 `---` 分隔符之间的 JSON 前置信息和生成的图片区域。Markdown 是权威记录，`INDEX.md` 是生成的导航。搜索直接扫描文档，因此手动编辑会立即生效。请保留元数据和图片区域标记，再运行 `reindex` 更新导航。JSON 输入及命令见[技能说明](../../../.agents/skills/dsh-memory-documents/SKILL.md)。

在本源码仓库中，可以初始化空存储或重建索引：

```sh
node .agents/skills/dsh-memory-documents/scripts/memory-documents.mjs init
node .agents/skills/dsh-memory-documents/scripts/memory-documents.mjs reindex
```

PNG、JPEG、WebP 和 GIF 附件会在文档发布前按内容哈希复制。辅助脚本检查文件签名，默认每张图片上限为 20 MiB；可通过 `--max-image-bytes` 修改。`read_image` 负责图片解码，并执行部署环境独立的图片限制。保存成功后可删除原始参考文件。失败的保存可能留下未使用的图片副本；目前不提供自动附件清理。

失败时命令返回非零状态并输出 JSON 错误。`REVISION_CONFLICT` 要求重新读取。`BUSY` 指明写入锁；只有确认锁中记录的进程已经停止，才能移除遗留锁。`INDEX_UPDATE_FAILED` 会明确报告文档已经提交：修复原因后运行 `reindex`。文档缺失、格式错误或附件缺失都会被报告，不会被静默跳过。
