---
kind: upgrade-guide
description: "知识库在基于 base 的 profile 中默认启用，替代实验性可选 bundle。"
---

# 知识库成为内置能力

[English](guide.md) | 中文

## 变更

基于 base 的 profile 默认挂载文档知识库。Web 和 Desktop 提供固定侧边栏入口，插件页不提供启停开关。文件仍保存在 `$DSH_HOME/storages/knowledge-base`，文档标识和版本保持不变，不会自动导入任何文件。

服务包为 `@deepseek-ai/dsh-knowledge-base`，页面包为 `@deepseek-ai/dsh-client-ui-knowledge-base`，它们替代先前的实验包。

## 迁移

1. 将每个已有 profile 启动一次。加载过程会从选中的 bundle 列表移除 `@deepseek-ai/dsh-experimental-knowledge-base`，保留其余清单字段，由默认组合提供能力。
2. 自定义组合将实验包名替换为上述产品包名，保留 `knowledge-base` 的配置覆盖及原索引路径。API 仪表数据新增 `availability`（`ready` 或 `unsupported-platform`）。
3. 确认无需开启插件即可看到侧边栏入口，既有文档仍可读取。Intel macOS 的应用及管理页正常可用，索引功能显示明确的平台不支持状态。
