---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-02-model-group-log

[English](2026-11-02-model-group-log.md) | 中文

## 概述

新增模型群配置、停止状态、投递归属、公开消息、定向消息接收回执、旧版仅通知输入，以及可选且不可变的 Team 协调创建方。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-02-model-group-log
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-22-action-card-status"
    after: "5adf5419528ba88fd43c03e797037f9ea09073e1148bb1129ffecd38ff9395cb"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-22-action-card-status"
    after: "da068e2fdadd939ed9c43a7d518bbf67074490b621125d8b152d71c410e92025"
    decision: same-version
  - root: "event:model-group/configured"
    previous: null
    after: "a1059de515e04c62bb88dc809061ec527151f716a0a8a362f7f0fcf1b9f02179"
    decision: same-version
  - root: "event:model-group/delivery"
    previous: null
    after: "740ee628a101f94612c5b68114532352dd7b94366ca88e6cf675082cdc6e7dd4"
    decision: same-version
  - root: "event:model-group/dispatched"
    previous: null
    after: "87665aacf72a280474251fa2bb61e3027ecd6a66dc4dace062e7d1a40db771d7"
    decision: same-version
  - root: "event:model-group/member-stopped"
    previous: null
    after: "40301c3c85a0938a68b951415d4faeae615cd25150a7385999e9f49bc45188b4"
    decision: same-version
  - root: "event:model-group/post"
    previous: null
    after: "229ccf61e83412d3eeb162769fbb1cf558e9b0b5a2bda2b2f49f3b9f5801992b"
    decision: same-version
  - root: "event:model-group/stopped"
    previous: null
    after: "9c896e42bbc5434f132da30be1926f3ae8d9511edd06c9eed533ae8a6229c99b"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-22-action-card-status"
    after: "9d0736325d6f9d106c38bc2db06733a33dfc8e9f08a0358f42239acb234b4452"
    decision: same-version
  - root: "event:team/member"
    previous: "2026-09-11-initial"
    after: "2b793290774a8944713568c64f36a8f0d6844ed1f5608051a071241ab613fd21"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-22-action-card-status"
    after: "5ebf9f67d71fe74532e57bfa9483c25221538d4bafae324981d97df29c049cfb"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有记录保持有效，未声明协调创建方的成员仍视为未分配。model-group/dispatched 判别标签将公开输入序号关联到接收回执，不声称执行完成。旧读取器拒绝此未知的必需标签，不将其解释为回复。当前读取器保留旧通知来源和已有模型群事件，既有标签不增加其他解释。新的定向消息不再启动人造的 leader 轮次。 可选的 publicMessage 标记识别规范的 user/message 输入；标记缺失时保留已有公开消息解释。普通用户记录保留标题与活动发现，之后的 leader 请求仍可重建这些输入。

<a id="verification"></a>
## 验证

运行时、Loader 组合、Team 名单、Chat 投影、输入触发器、引用与模型群界面的定向测试覆盖当前模型选择、不在线成员省略模型、不会启动 leader 轮次的定向投递、回执持久化和模型定向与历史引用标签区分。模型群记录会话场景在显式切换路由后执行 list_agents。

<a id="dev-note"></a>
## 开发备注

无。
