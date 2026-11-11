---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-11-upstream-reconciliation

[English](2026-11-11-upstream-reconciliation.md) | 中文

## 概述

合流 Neurix 与上游独立的确认历史，保留模型组输入，并纳入上游重试、调用方归属、子任务结算元数据及不完整技能目录标记。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-11-upstream-reconciliation
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: ["2026-10-27-retry-control-input","2026-11-02-model-group-log"]
    after: "c01312dce265a26f033f25e012830cdc159b93a8c6074e05130f77e84855d2ec"
    decision: same-version
  - root: "event:developer/message"
    previous: ["2026-10-27-retry-control-input","2026-11-02-model-group-log"]
    after: "17c1b0ac5a36418912eb86c56f212cd97d32e7ffcd08f299b71837dc5701dc3f"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: ["2026-10-27-retry-control-input","2026-11-02-model-group-log"]
    after: "02651b56829e75445cb3d3581b196a2ccfbaf3c4e5366ca4824b7d30cfe5966a"
    decision: same-version
  - root: "event:user/message"
    previous: ["2026-10-27-retry-control-input","2026-11-02-model-group-log"]
    after: "e31ec829991312695ddb74564b6593c1229b6e6d72ade53e5d039ab09fb31a6b"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

既有事件判别标签与 Session 格式 4 保持不变。每个合流根分别与两条历史分支末端比较。模型组 notice 来源保留已记录字段。principal、stopReason 与 incomplete 缺失时保留原有含义。调用方联合类型仍接受 owner 记录，并增加 share-viewer 归属。旧 Neurix 读取器保留这些 user/developer 来源 JSON 对象，包括未知 retry kind 与调用方元数据，不从中推导实时访问权限；普通消息内容仍可读取。更新后的读取器接受双方历史来源。新增元数据不重新解释已有 Team 或模型组事件。所有历史确认记录与按版本命名的 Session 代际文件均保留。

<a id="verification"></a>
## 验证

持久化历史与 schema 测试通过 172 项，涵盖显式合流、拒绝未合流分支、独立前驱检查、前驱保留、删除墓碑及历史文件不可变。当前格式恢复测试通过 3 项。Session 封装、继续执行、Remote 访问、LiveShare 身份、旧 Team 持久化及模型组测试通过 281 项。

<a id="dev-note"></a>
## 开发备注

无。
