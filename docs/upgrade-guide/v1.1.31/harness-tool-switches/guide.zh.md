---
kind: upgrade-guide
description: "Harness 工具用 Agent 委派开关替代终端启动和续接按钮。"
---

# Harness 工具开关

[English](guide.md) | 中文

## 变更

**设置 → Harness 工具**用于控制 Agent 能否调用 Codex 和 Claude Code。设置页移除了终端安装检测、**启动**和**续接会话**按钮。

## 迁移

1. 若要委派任务，请在**设置 → Harness 工具**中打开 **Codex** 或 **Claude Code**。桌面版和打包的 Web 服务随附这两款工具的提供方。请在会话中请 Agent 调用该工具，并展开运行卡片确认活动。
2. 若要手动使用 CLI，请打开工作区终端。输入 `codex` 或 `claude` 启动，或输入 `codex resume` 或 `claude --resume` 打开工具自带的会话选择器。
