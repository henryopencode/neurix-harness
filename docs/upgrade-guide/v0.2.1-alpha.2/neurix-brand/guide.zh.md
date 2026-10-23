---
kind: upgrade-guide
description: "桌面应用路径与安装包文件名改用 Neurix Harness 品牌。"
---

# 桌面应用与安装包名称

[English](guide.md) | 中文

## 变更

桌面应用名为 `Neurix Harness`。macOS 应用包名为 `Neurix Harness.app`，安装包产物使用 `neurix-harness-` 前缀。引用原应用或安装包文件名的快捷方式与脚本需要使用新文件名。现有 npm 包名、`dsh` 命令、`DSH_HOME` 与 Harness 数据目录名称保持不变。

## 迁移

1. 安装适用于当前平台的 Neurix Harness 桌面应用。
2. 将引用 `DeepSeek Harness.app` 的快捷方式与脚本改为引用 `Neurix Harness.app`；将安装包文件名前缀从 `deepseek-harness-` 改为 `neurix-harness-`。
3. 打开应用，检查“关于”面板是否显示 `Neurix Harness`。继续使用现有 `dsh` 命令与 Harness home。
