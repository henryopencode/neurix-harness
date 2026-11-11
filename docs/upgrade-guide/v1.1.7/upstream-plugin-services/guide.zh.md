---
kind: upgrade-guide
description: "自定义 MCP 与命名队友集成使用独立服务，固定 1017 模型角标包被移除。"
---

# 上游插件服务与模型角标

[English](guide.md) | 中文

## 变更

内置 MCP 配置页面使用 `@deepseek-ai/dsh-mcp-config-manager`，通过 `ctx.mcpConfigManager` 和 `remote.mcpConfigManager` 提供服务。`@deepseek-ai/dsh-mcp-manager` 提供上游基于设置的服务器管理。随附 Web 与 Desktop 组合同时选择这两个包；现有 MCP 客户端声明仍保存在 profile 补丁中。

可选的 `@deepseek-ai/dsh-experimental-agent-team-profile` 通过 `ctx.legacyAgentTeams` 与 `legacyAgentTeam` 投影保留命名队友及按时间排列的团队视图。启用此组合包会替代该 profile 的内置团队模式。上游团队模式使用 `ctx.agentTeams` 与 `agentTeam` 投影。已有团队日志记录保留事件名称和数据。

引用原有服务名称的自定义插件与显式 profile 覆盖需要以下调整。选择现有可选团队组合包无需手动重写 profile。

固定 `@deepseek-ai/dsh-client-ui-deepseek-model-label-1017` 包被移除。模型目录提供可选角标，选择器不再自行添加 `1017`。

## 迁移

1. 对于 MCP 配置编辑器行，将包名改为 `@deepseek-ai/dsh-mcp-config-manager`，id 改为 `mcp-config-manager`。将编辑器导入、远程调用和访问检查中的 `mcpManager` 改为 `mcpConfigManager`。保留 `@deepseek-ai/dsh-mcp-client` 服务器行。
2. 对于可选命名队友组合包的集成，将 `ctx.agentTeams` 改为 `ctx.legacyAgentTeams`，读取 `legacyAgentTeam`。自定义行覆盖使用 `legacy-agent-team`、`legacy-tool-agent-team` 和 `legacy-ui-agent-team`。保留可选组合包的包名。
3. 重启 profile 后打开 MCP 页面和团队视图。提交新任务前，确认现有服务器声明与已记录的队友消息可见。需要上游 pull request 面板时，在插件页面启用**变更请求与工作树**。

4. 删除 `ui-deepseek-model-label-1017` 行覆盖及其包依赖。[模型角标指南](../../v0.2.1-rc.2/model-badge-package-removal/guide.zh.md)说明自定义标签扩展。重启后，确认模型选择器使用目录中的名称与角标，且没有缺失行警告。
