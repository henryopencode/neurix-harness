---
kind: upgrade-guide
description: "电脑控制拆分为原生应用操作和独立浏览器操作。"
---

# 分离浏览器和应用操作

[English](guide.md) | 中文

## 变更

可选的电脑控制插件改为**应用操作**，保留包名和 `computer-control` 设置条目。工具名为 `application`，支持 macOS 原生窗口，包括浏览器应用，并始终使用系统前台输入。**浏览器操作**是独立的可选插件，拥有 `browser` 工具、独立审批和画中画，以及隐藏的 Playwright 会话。两个插件可同时运行。

## 迁移

1. 操作原生应用时保持应用操作启用。针对该插件的工具集成，将 `computer` 改为 `application`。
2. 需要独立网页任务时，在插件页启用**浏览器操作**，或向配置档案的 bundles 加入 `@deepseek-ai/dsh-experimental-browser-control`。使用 `browser` 工具。
3. 将仅属于浏览器的覆盖值（`browserChannel`、`browserViewportWidth`、`browserViewportHeight`）从 `computer-control` 移至 `browser-control`。移除 `headless`；浏览器始终隐藏。分别设置两个插件的 `requireInputApproval`。
4. 保存设置并新建对话，确认各插件只暴露自己的操作和画中画。独立统一提供者的配置仍保留 `computer` 工具和模式设置。
