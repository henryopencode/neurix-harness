---
kind: upgrade-guide
description: "Neurix Harness 要求 Node.js 24.9 或更新版本，并采用上游 0.2.1-rc.3 的模型与 Session 兼容性变更。"
---

# 将 Neurix Harness 升级到 0.2.1-rc.3

[English](guide.md) | 中文

## 变更

Neurix Harness 集成上游 0.2.1-rc.3 运行时，同时保留图片生成、统一电脑控制、轮次收藏和品牌定制。包名、`dsh` 命令和默认的 `~/.dsh` 数据目录保持不变。仓库保留独立的提交历史。

源码安装要求 Node.js 24.9 或更新版本。pi-ai 模型目录删除了部分模型 ID，并调整了容量。普通 Session 分叉成为独立 Session；旧版 V4 读取器可能拒绝新的分叉日志。HTTP 抓取允许访问内网地址。上游实验性电脑控制和推荐 bundle 仍需自行启用。

## 迁移

1. 停止正在运行的实例并备份 Harness 主目录。若设置了 `DSH_HOME`，备份该目录；否则备份 `~/.dsh`。创建或打开新分叉前，升级所有共享该 Session 目录的进程。
2. 选择 Node.js 24.9 或更新版本。使用 nvm 时，在源码目录运行 `nvm use`，选择 `.nvmrc` 固定的版本，再用 `node --version` 确认。
3. 运行 `pnpm install` 和 `pnpm run build`。通过 `pnpm dsh web` 或现有启动器启动常用 profile。
4. 按[模型目录迁移指南](../../v0.2.1-rc.2/pi-ai-model-catalog/guide.zh.md)检查模型选择。自定义插件还需检查[工具执行](../../v0.2.1-rc.2/tool-executor-plugins/guide.zh.md)和[模型选择](../../v0.2.1-alpha.4/session-model-selection/guide.zh.md)的变更。
5. 若部署限制访问内网服务，请检查 [HTTP 抓取网络策略](../../v0.2.1-rc.2/web-fetch-private-destinations/guide.zh.md)。向旧版安装共享新日志前，请检查[分叉日志的读取要求](../../v0.2.1-rc.3/independent-session-forks/guide.zh.md)。
6. 确认已有对话可以打开、配置的模型可以回复，且图片生成、电脑控制和收藏仍可使用。这些集成保留已保存的配置及显式启用方式。
