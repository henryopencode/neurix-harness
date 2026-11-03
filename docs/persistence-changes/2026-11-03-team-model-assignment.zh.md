---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-03-team-model-assignment

[English](2026-11-03-team-model-assignment.md) | 中文

## 概述

为原有团队日志增加候选模型、用户停止控制和按职责署名的公开回复。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-03-team-model-assignment
baseline: false
changes:
  - root: "event:team/control"
    previous: null
    after: "e7dc7e291279ecac2c2291e82d8004312c7c6e165f69ace8331d18c3ec976c41"
    decision: same-version
  - root: "event:team/models"
    previous: null
    after: "3c856d90656eea4b2a37a1314ef2269fa86f130091f469e99512d13f2bf6ebe7"
    decision: same-version
  - root: "event:team/post"
    previous: null
    after: "3c15bfec435853b32326afc8bacdcabf531edb07bdf857f946c54dd2b7d296c2"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有团队和模型群记录的事件字段保持不变，仍可读取。新增 team/models、team/control、team/post 是必读判别项；旧读取方会拒绝未知的非可忽略事件，避免错误解释团队状态。当前读取方接受没有这些事件的旧日志，通过新增记录接收模型默认值。Session 头版本不变。

<a id="verification"></a>
## 验证

111 项团队领域、工具和客户端测试通过。实际安装的团队组合包将 reviewer 和 researcher 职责分配给不同模型路由，并通过随附 headless 配置档生成了团队模型分配测试记录。

<a id="dev-note"></a>
## 开发备注

无。
