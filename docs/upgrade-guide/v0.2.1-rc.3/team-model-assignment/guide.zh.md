---
kind: upgrade-guide
description: "将独立模型群配置迁入智能体团队，通过原有队友职责选择模型。"
---

# 团队模型分配

[English](guide.md) | 中文

## 变更

智能体团队支持配置候选模型与组长模型。组长通过 `spawn_teammate` 创建本次任务的职责，通过 `model` 别名选择模型，角色名称与说明独立于模型。配置候选模型后，调用必须明确指定候选别名；没有候选配置时继续继承模型选择。

独立模型群入口从插件主列表隐藏。统一团队流程中没有独立的模式选择与模型群分配工具。历史回复记录仍可阅读。

## 迁移

1. 在配置档 `package.json` 的组合包列表中选择 `@deepseek-ai/dsh-experimental-agent-team-profile`，取消选择 `@deepseek-ai/dsh-experimental-model-group`。
2. 将 `model-group` 覆盖项的配置迁入 `agent-team`：`members` 改名为 `models`，`leader` 改名为 `leaderModel`，保留 `maxParallel` 并移除 `defaultMode`。保留候选提供方路由、精确模型 id、名称与擅长任务。原有团队部署限制可保留在同一配置中。
3. 保存后重新启动或加载配置档。在团队插件详情核对组长与候选模型，使用新会话验证按职责分配模型；已有会话保留历史和已经记录的选择。
4. 将显式模型工具 `model_group_assign` 改为 `spawn_teammate`，填写 `name`、`description`、`prompt` 和 `model`。用户控制命令改为 `/team tell <成员或模型> <消息>` 和 `/team stop [成员]`。
