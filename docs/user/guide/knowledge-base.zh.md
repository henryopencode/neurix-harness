# 添加文档知识库

[English](knowledge-base.md) | 中文

跨会话查询参考手册和项目文档，同时由现有记忆系统保留个人偏好和决定。

## 启用知识库管理

在 Web 或 Desktop 中，直接打开侧边栏的**知识库**。此能力已内置，默认启用。通过侧边栏入口导入和管理工作区文档。索引保存在本机；记忆系统继续单独管理个人偏好。

### 源码示例

先构建工作区，使用 Node 24.9 或以上版本，以及 LanceDB 支持的架构：Apple Silicon macOS、Linux 或 Windows。Apple Silicon 需要 ARM Node，不能使用 Rosetta 下的 Intel Node。

```sh
pnpm dsh web --patch "$PWD/apps/cli/config/examples/knowledge-base.cordis.yml" --no-open --port 0
```

打开打印的网址并选择工作区。示例将索引保存在 `$DSH_HOME/storages/knowledge-base`。点击侧边栏的**知识库**可导入和管理文档。现有记忆页面仍单独管理个人偏好。

## 导入与提问

将 Markdown、UTF-8 TXT 或文字 PDF 文件放到选定工作区。让 Agent 导入该文件，再就内容提问并要求引用来源。同一原始工作区的后续会话可以检索已导入文档；其他工作区的会话无法检索。

Agent 使用 `knowledge_import`、`knowledge_search`、`knowledge_read`、`knowledge_list` 和 `knowledge_remove`。可以要求重新导入修改后的源文件、列出资料，或移除已导入文档。移除操作保留原文件和个人记忆。源文件修改后需要重新导入；删除源文件不会删除索引快照。

## 管理文档和浏览关联

在知识库页面选择工作区，然后导入 Markdown、TXT 或文字 PDF。点击文档节点或列表条目可查看已导入原文及其页码或行号。选择关键词可筛选关联文档。搜索会查询文档内容；图谱支持缩放和平移。

上传同名文件时会先确认是否更新导入版本。移除文档同样需要确认，只影响该工作区的索引。图谱显示有界样本中的文档与关键词共现，不断言语义关系。

## 可选语义检索

示例默认使用本地关键词检索，无需凭据。已有的 Ollama embedding 服务和模型可以同时启用语义与关键词检索；[包参考](../../../packages/core/knowledge-base/README.zh.md#retrieval-and-limits)负责配置和重建索引要求。仅在显式配置 embedding 端点后，片段才会发送到该端点。
