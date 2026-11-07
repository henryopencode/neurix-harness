---
description: "可选模型群 bundle 的 Host 编排，包括逐会话配置、定向模型投递和公共任务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-model-group-runtime

[English](README.md) | 中文

## 概述

让已配置模型在指定 leader 的协调下工作，共享任务归属，并将用户消息直接投递给模型。每个会话刷新后仍保留各自的模型群。通过[模型群 bundle](../model-group/README.zh.md) 使用设置页面和会话控制项。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

模型群 bundle 在已有 Team service 旁挂载此运行时。其 `model-group` 配置项持有 [bundle 参考](../model-group/README.zh.md#use-this-package) 所述的可编辑默认值。Host 调用方使用 `ctx.modelGroups`；浏览器控制项使用经过鉴权的用户命令，而不直接激活子 Session。

保存成员、leader 和擅长任务默认值时，空闲且尚未使用的会话会通过记录 `model-group/configured` 事件更新。投影恢复输入或执行是否已经开始，使已使用的会话在重新加载后仍保留模型路由。会话自身选择的模式保持不变。空白会话的 Agent 恢复时也会同步默认值。

多模型模式下，leader 与成员保留配置的提供方和模型。调用方可以修改该路由的思考强度；重新激活运行时会保留 leader 已选的强度。单模型模式恢复自由选择模型。

任务分配在接收子执行前校验已配置成员、模型路由、停止状态和可用容量。每项已接收任务标识目标 Session 和公共任务。Team service 校验归属和修订号。执行失败或中断会释放其拥有的任务，成功结算会完成任务。部分投递会报告已确认的收件人及未确认结果，不声称已经回滚。

leader 接收自己的精确模型别名，以及只包含其他模型的分配名单。leader 直接回答自己的部分；分配给自己会在创建任务或公开消息之前以 `GROUP_SELF_ASSIGNMENT` 拒绝。分配指令保留在工具输入中，成员回复才发布为带署名的公开消息。省略或留空 `task_id` 会自动创建公共任务，结算自动完成任务；普通讨论不需要单独创建任务或由成员调用完成操作。

发给成员的用户输入使用普通 `user/message` 记录，保留会话活动与标题发现，不请求 leader 回答。用户定向消息记录并刷写 `model-group/dispatched`，将公开输入的序号关联到成员与任务的接收回执，以及未确认的收件人。可选的 `publicMessage` 标记区分普通输入与旧公开消息。接收仅表示投递成功；各成员的执行保留各自的运行与结算状态。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

运行时将可恢复配置存储在 `modelGroup` 投影中，使用可续接子 Agent 执行模型，并在 leader 日志中发布带署名的公开消息。逐群控制器在停止期间关闭接收入口、取消预检、等待进行中的启动，并在报告静止前清理已接收的执行。服务卸载保留投影读取器直到所拥有的工作完成。纯回放不会启动模型。配置 m 个模型时，投影存储与协调更新成本为 O(m)；无关事件以 O(1) 保留原状态。公开消息保留在分页历史中。

[Team 子系统](../../../docs/subsystems/agent-team.zh.md#model-groups) 记录公开类型与生成的服务 API。浏览器安全的消费者导入 `./types` 入口；Host 类及其服务声明不进入 Client 编译程序。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 群任务投递

#### 模型看到什么

共享系统规则将模型分配保留给 leader，并要求成员直接完成自己的工作。leader 通过已记录的运行时上下文接收自身身份、其他模型、停止状态和可编辑的擅长描述，以及 `model_group_assign` 和 `model_group_tasks`。成员接收任务输入与公共任务 id；回复和结算结果自动到达群与 leader，无需重复发送结果消息。规则要求 leader 综合观点，而不是完整复述公开回复。用户定向请求由所选模型处理；其结算不会请求额外的 leader 回答。

#### Token 影响

各模型拥有独立请求历史。成员上下文随配置成员数量增长；任务投递和结果通知追加到接收者的历史。普通定向输入也进入 leader 的日志历史，供之后的请求使用，但投递时不启动 leader 调用。单独的公开消息记录不增加模型 token。

#### KV Cache 影响

续接复用各模型自身持久化的前缀。新成员接收任务所需的上下文，不继承 leader 的全部历史。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 成员共享一个进程和工作目录。写入范围只是提示。
- 公开文本按 assistant 消息结算。
- 群重启不重放具有外部副作用的操作；模型可能需要检查部分工作后再继续。

<a id="dev-note"></a>
### 开发备注

无。
