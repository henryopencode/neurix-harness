---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-25-native-subagent-activity

[English](2026-11-25-native-subagent-activity.md) | 中文

## 概述

在父 Session 中记录原生 subagent 的运行活动，供实时聊天和重开的会话展示。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-25-native-subagent-activity
baseline: false
changes:
  - root: "event:subagent/activity"
    previous: null
    after: "c655b31b2fa0ea1fae76e3b256eb2f83b1e74e51c32ad8f0010010cfe8f732ea"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

每条记录仅进入日志，并标记 ignorable: true。旧读取器会保留这类未知记录，不将其应用到模型历史或恢复流程。新读取器打开缺少该记录的旧日志时不显示原生运行卡片。目录条目和完成通知继续向各自的使用方提供子任务身份和结果。

<a id="verification"></a>
## 验证

标准事件信封测试覆盖不透明可忽略记录的保留。外部 activation 测试校验新记录带有该标记，且派生消息保持不变。官方 Claude Code Web 快照使用本地模型模拟服务验证实时工具调用和执行结算。

<a id="dev-note"></a>
## 开发备注

无。
