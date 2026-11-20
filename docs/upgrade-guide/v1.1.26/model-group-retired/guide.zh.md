---
kind: upgrade-guide
description: "安装包不再提供模型群，配置档在加载时自动取消选中该插件。"
---

# 移除模型群

[English](guide.md) | 中文

## 变更

模型群插件、会话模式及 `/model-group` 命令已移除。配置档加载时会自动从 `dsh.profile.bundles` 移除 `@deepseek-ai/dsh-experimental-model-group`。已有会话仍可打开，模型群事件仍保存在 Session 日志中。

## 迁移

1. 如果在 `cordis.patch.yml` 中添加了 `model-group` 或 `model-group-ui` 覆盖项，请移除。也请移除自定义 `cordis.yml` 中显式添加的模型群插件条目。
2. 打开配置档，确认插件列表不再显示模型群。新会话可以使用[智能体团队](../../../subsystems/agent-team.zh.md)协作。
