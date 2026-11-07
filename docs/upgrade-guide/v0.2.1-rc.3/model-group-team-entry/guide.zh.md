---
kind: upgrade-guide
description: "模型群通过共享的 agent-team 入口配置 Team service，不再使用 model-group-team。"
---

# 模型群 Team service 入口

[English](guide.md) | 中文

## 变更

模型群 bundle 的 Team service 入口由 `model-group-team` 改为 `agent-team`。同时选择 Agent Teams 与模型群时，两个 bundle 共用此入口。已有指向 `model-group-team` 的覆盖项需要改为 `agent-team`。

## 迁移

1. 在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`、主目录的 `cordis.patch.yml` 和启动覆盖文件中，将 Team service 的覆盖项 id 从 `model-group-team` 改为 `agent-team`，保留服务配置值。
2. 同时选择两个 bundle 时，将共享 Team 限制放在一份 `agent-team` 配置档覆盖项中；它优先于任一 bundle 的初始配置。
3. 重新加载或重启配置档，确认团队协作处于运行状态，且没有 `agentTeams` 重复注册警告。模型群既可以单独启用，也可以与 Agent Teams 一起启用。
