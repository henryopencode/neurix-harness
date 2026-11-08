---
kind: upgrade-guide
description: "智能体团队移除候选模型设置和定向消息命令。"
---

# 智能体团队设置

[English](guide.md) | 中文

## 变更

智能体团队使用原有的成员和共享任务面板。移除 `models`、`leaderModel`、`maxParallel` 设置，以及 `/team tell` 和 `/team stop` 命令。队友继承负责人的模型。已有 Session 事件类型仍可读取。

## 迁移

1. 从 profile patch 的 `agent-team` 条目中移除 `models`、`leaderModel` 和 `maxParallel`。使用 `maxMembers` 限制累计队友数量。
2. 告诉负责人通过现有团队工具分配工作，打开**智能体团队**查看成员与共享任务。
