---
kind: upgrade-guide
description: 自定义会话持久化后端必须实现永久删除，并等待派生记录清理。
---

# 自定义后端的会话永久删除

[English](guide.md) | 中文

## 变更

`SessionPersistence` 要求实现 `delete(id): Promise<boolean>`。自定义后端必须实现此方法以支持永久删除已归档会话。随产品提供的 JSONL 后端已实现它。现有会话格式与项目文件不变。

## 迁移

1. 在后端实现 `SessionPersistence.delete`。删除数据前拒绝活动写入拥有者，移除目标 id 的全部存储代际，并返回该 id 是否存在。
2. 存储移除后，等待 `ctx.serial('session-persistence/deleted', id)` 清理派生记录。目标不存在时也分发此事件，以便调用方重试未完成的清理。存储与清理失败都继续向上传递。
3. 验证活动写入方会阻止删除、重新打开后端后目标仍不存在，以及重试不存在的 id 能完成派生记录清理。
