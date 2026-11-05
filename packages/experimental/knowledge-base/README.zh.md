---
description: "工作区文档知识库：通过原生工具导入本地 Markdown、TXT 和 PDF，保留来源引用，并可选配置 Ollama embedding。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-knowledge-base

[English](README.md) | 中文

## 概述

导入参考文档，在同一工作区的不同会话中检索原文片段。搜索可以在本地运行，无需模型或 API 密钥；显式配置 Ollama embedding 后可启用混合检索。每个片段保留源文件、导入版本以及页码或行号。个人偏好和决定仍由独立的记忆系统管理。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在 Web 或 Desktop 的插件页启用**知识库**，即可添加文档管理和原生 Agent 工具。内置 profile 提供此 bundle，默认关闭。索引保存在 `$DSH_HOME/storages/knowledge-base`，与 Session 日志和记忆数据库分开。支持 Apple Silicon macOS、Linux 和 Windows；此版本的 LanceDB 不提供 Intel macOS 原生绑定。

Bundle 的[叠加配置](cordis.patch.yml)挂载本服务和[管理 UI](../client-ui-knowledge-base/README.zh.md)。停用后会移除工具及页面，并保留索引文档。提供 `tools`、`fs` 和 `workingDirectory` 的自定义组合也可以直接挂载服务。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-experimental-knowledge-base'
  config:
    path: /absolute/path/to/knowledge-index
```

让 Agent 导入 Markdown、UTF-8 TXT 或文字 PDF 文件，再就该资料提问。`knowledge_import` 返回文档 ID 和版本。`knowledge_search` 检索片段；`knowledge_read` 按精确版本读取从零编号的片段。`knowledge_list` 列出文档元数据及分页偏移。`knowledge_remove` 在用户明确要求时删除索引中的片段，保留原文件和个人记忆。

访问范围由 Session 的原始工作区决定。切换当前工作目录会改变相对源文件路径的解析位置，但不会获得另一工作区的文档。同一规范源路径的再次导入会原子替换索引版本，包括移除多余的旧尾部片段。源文件修改后必须重新导入才会生效；读取过期版本会拒绝。删除源文件不会删除已导入的快照。

### 文档管理

在提供工作区控制器和类型化 Gateway 的 Web 或 Desktop 组合中，此插件同时开放按工作区授权的文档管理。挂载[可选 UI 包](../client-ui-knowledge-base/README.zh.md)可添加侧边栏入口、浏览器文件导入、原文读取及文档与关键词图谱。上传文件名使用独立来源标识；上传同名文件需要明确确认替换。图谱从有界原文样本提取关键词共现，不推断语义事实关系。

<a id="retrieval-and-limits"></a>
### 检索与限制

默认通过本地 ICU 分词全文索引检索中文及其他文字。启用混合检索时，为选定 Ollama 服务上已经安装的 embedding 模型配置 `embedding.baseUrl` 和 `embedding.model`。导入片段和查询会发送到该配置端点。插件不会下载模型，也不会将聊天模型自动选作 embedding 模型。更换 embedding 目标需要使用新索引目录并重新导入文档。

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-knowledge-base)负责所有字段及默认值。文件字节数、提取文字长度、片段数量、搜索数量和完整 UTF-8 结果大小分别受限。单个片段无法容纳时会明确拒绝；搜索和列表分页会减少条目数以符合预算。相邻片段不重叠，使重复原文也能保留正确行号；需要周围内容时使用 `knowledge_read` 读取相邻片段。

### 失败与恢复

不支持的格式、空文档、超限来源和已取消操作会在替换文档前拒绝。扫描 PDF 需要先做 OCR。无效模型响应会在发布前拒绝。原生写入失败会报告 `KNOWLEDGE_WRITE_UNKNOWN`：先列出并读取当前版本，再决定是否重试。关闭插件会停止受理新操作，并等待所拥有的文件读取和索引操作结束后才释放资源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Cordis 服务、LanceDB 提供方和原生工具消费者位于同一个包。文件系统提供方负责源文件读取和规范路径。LangChain 将提取的文字切成有界片段；LanceDB 负责原子文档替换、全文搜索及可选向量检索。持久化格式标记防止不兼容的 embedding 目标共用索引。

一个操作队列负责源文件准备、原生操作、取消和连接关闭。每次查询先按调用方的原始工作区过滤，再限制结果数量。原文通过普通工具结果进入模型和会话日志，携带导入版本，而非依赖源文件的实时状态。

- [服务与配置](src/index.ts)
- [LanceDB 索引](src/engine.ts)
- [源文件提取与切分](src/sources.ts)
- [原生工具及其 schema](src/tools.ts)

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [能力接缝](../../../docs/architecture.zh.md)——插件组合与提供方所有权。
- [文件系统服务](../../fs/fs/README.zh.md)——执行环境中的源文件访问。
- [工作目录](../../session/working-directory/README.zh.md)——原始工作区与当前目录。

-----

<a id="model-experience"></a>
## 模型体验

### 原生知识库工具

#### 模型看到什么

[五个原生工具的 schema](src/tools.ts)（包括 `knowledge_import` 和 `knowledge_search`）描述文档导入、搜索、精确版本读取、列表与删除。结果为有界 JSON，包含源路径、文档 ID、内容版本和片段位置。搜索与读取描述将原文归类为不可信参考资料，并要求引用来源。文档不会自动注入上下文，也不会自动变成个人记忆。

#### Token 影响

启用工具会贡献其 schema。被调用的操作将有界结果加入 Session 历史；文档正文仅出现在返回的搜索或读取片段中。关键词检索不请求模型；已配置的 embedding 调用仅向选定服务发送源片段或查询。

#### KV Cache 影响

工具结果追加到现有历史。启用或停用插件会改变工具声明，可能使请求前缀无法复用。修改索引文档会影响后续结果，已记录的片段保持原样。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

此可选实现具有以下限制。

- 仅支持文字 PDF：不包含 OCR、Office 格式、网站同步、目录监听。
- 原生 LanceDB 需要受支持的运行架构；所选版本支持 Apple Silicon macOS、Linux 和 Windows，不提供 Intel macOS 绑定。
- 每个索引目录由一个运行中的插件实例拥有。文档列表的偏移分页要求集合在两次请求之间保持不变。
- 工具按原始工作区路径限制访问；此服务不提供多用户授权。可信服务调用方负责其工作区授权。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
