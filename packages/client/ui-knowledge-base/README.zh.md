---
description: "从侧边栏管理工作区知识文档、检查原文片段，并浏览文档与关键词的关联。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-knowledge-base

[English](README.md) | 中文

## 概述

在独立的侧边栏页面导入和管理参考文档。浏览关键词共现关联、搜索文档内容，并查看带页码或行号的原文片段。页面默认浏览全部项目，也可按工作区筛选；各项目资料仍独立保存，与个人记忆分开管理。

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

在提供工作区控制器、类型化 Gateway 和标准 Client 服务的 Web 或 Desktop 组合中，默认将此内置页面与[文档知识库](../../core/knowledge-base/README.zh.md)共同挂载。无需手动启用插件。

```yaml
- name: '@deepseek-ai/dsh-knowledge-base'
  config:
    path: /absolute/path/to/knowledge-index
- name: '@deepseek-ai/dsh-client-ui-knowledge-base'
```

点击侧栏的书本图标打开**知识库**，可浏览全部项目，也可通过统一下拉筛选工作区。支持导入 Markdown、TXT 或文字 PDF；全局视图下导入时需选择目标项目。顶部显示文档数量。右侧展示所选文档的原文段落及页码或行号。切换项目或文档时，图谱和阅读区高度保持稳定，文档列表与原文分别滚动。段落是导入原文中用于检索的一部分，可直接选择或逐段翻阅。点击文档节点查看来源，点击关键词筛选关联文档。滚轮以指针位置为中心缩放，拖动节点可调整位置，拖动空白处可平移。重置在悬停或键盘聚焦时显示，触屏上保持可见。窄屏下文档区域位于图谱下方。在 macOS Desktop 中，可拖动页面标题或顶部空白处移动窗口；顶部控件仍可正常点击。

上传规范化后同名的文件时，会先确认是否替换导入版本。移除同样需要确认，并保留原文件。操作使用打开对话框时记录的工作区。请求失败会在原位或全局通知中显示；无法确认写入结果时会提示先重新打开知识库再决定是否重试。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Host 对每个调用执行工作区资源授权，并使用与原生工具相同的索引。共享 Client 资源管理仪表数据和精确版本原文读取。全局页面通过现有的工作区授权请求聚合数据，文档总量受单页配置限制，并为每篇文档保留所属工作区；Agent 工具仍按工作区隔离。功能状态仅保存选择意图、变更进度和通知。变更请求属于一次可取消的插件激活；卸载会等它们结束，再撤销生成的 Remote 方法。D3 在停止的模拟中计算确定性布局，不保留后台模拟计时器。

源码：[资源和侧边栏绑定](src/client/mount.ts)、[页面](src/client/Page.tsx)、[图谱](src/client/Graph.tsx)和[变更生命周期](src/client/source.ts)。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [用户指南](../../../docs/user/guide/knowledge-base.zh.md)——启用示例和导入文档。
- [知识库包](../../core/knowledge-base/README.zh.md)——索引、检索、预算与失败处理。
- [知识库 API](../../../docs/subsystems/knowledge-base.zh.md)——按工作区授权的管理结果。

-----

<a id="model-experience"></a>
## 模型体验

通过导入、替换或移除文档后的[知识工具结果](../../core/knowledge-base/README.zh.md#model-experience)间接影响模型；此 UI 不贡献模型提示词或工具 schema。

#### KV Cache 影响

管理读取不改变 Session 历史。文档更新会影响后续检索结果，已经记录的原文片段保留原始内容。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 图谱展示有界前部片段中的文档与关键词共现，不推断实体或语义事实。分页和搜索可能只显示资料集合的一部分。
- 每次导入一个文件。源文件同步、OCR 和目录监听遵循 Host 包的限制。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
