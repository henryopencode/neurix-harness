---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-08-task-plan-metadata

[English](2026-11-08-task-plan-metadata.md) | 中文

## 概述

为 todo 快照增加可选任务身份、阶段、前置依赖、完成标准、执行引用、结果、产物路径和所属轮次。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-08-task-plan-metadata
baseline: false
changes:
  - root: "event:todo/write"
    previous: "2026-09-11-initial"
    after: "2c187606e08fc85ad13f116151386ed787863cca3e66258a3c41e79a868d130e"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

todo/write 判别值以及必填 content/status 字段保留既有含义和三种状态值。当前读取方接受不含规划元数据或轮次的历史记录。较早读取方可以忽略新增描述字段，不会把待执行工作解释为已完成；依赖保持声明性质，不引入调度义务。私有 todos 检查点版本递增，使不兼容缓存从既有持久事件族重建。

<a id="verification"></a>
## 验证

聚焦的 todo 和工作流测试通过，覆盖拒绝时不追加、整表元数据持久化、新旧检查点恢复、完整回放、历史前置和实时追加。内置 headless 回放刷新覆盖新的 workflow-canvas 场景与既有 todo-write 消费方。

<a id="dev-note"></a>
## 开发备注

无。
