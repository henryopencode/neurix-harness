---
description: "在 dsh Web 配置档中设置模型群会话，指定 leader，直接 @ 模型，并共享任务。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-model-group

[English](README.md) | 中文

## 概述

通过模型群，让指定的 leader 将工作分配给已配置的模型，并在同一会话收集结果。你可以直接 `@` 某个模型，同时运行独立任务，查看公共任务，停止某个成员或当前轮次。启用此可选插件后，新会话默认采用模型群模式；每个会话都能切换为单模型，插件详情控制后续新会话的默认模式。成员共享会话的工作区和文件。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在插件页面启用**模型群**。进入详情，从现有模型目录选择成员，指定一个 leader，按需描述各模型擅长的任务，然后保存。服务商连接和凭证仍由普通模型设置管理。成员模型没有固定角色。

会话中的模式选择只影响当前会话。插件详情通过 `defaultMode` 设置新会话默认模式，通过 `members` 和 `leader` 设置模型群，通过 `maxParallel` 限制同时运行的成员模型；leader 不占成员名额。尚未使用的会话会同步已保存的成员、leader 和擅长任务，包括编辑器中已经打开的空白会话。已经接收输入或开始执行的会话保留各自记录的成员和 leader。空群允许当前模型回答，并提示你配置成员。

发送普通任务，由 leader 选择成员。自然语言中明确指定的模型偏好会指导 leader。通过 `@` 菜单选择模型可直接投递，引用可以出现在消息中间。同时 @ 多个模型时，各自独立接收消息。部分投递失败会报告已确认及失败或未确认的成员；重试前请检查它们的执行记录。文件和图片附件复用现有命令输入的接收路径。

成员栏显示运行活动，并提供定向消息和停止操作。公共任务板分别记录任务状态与所有者，不以活动状态代替任务状态。leader 可通过 `model_group_tasks` 建立依赖和文件写入提示，再通过 `model_group_assign` 启动已就绪的任务。执行成功结算后，其拥有的任务标记为完成；执行未成功时释放任务，并报告结果。文件写入提示不构成文件锁。

停止本轮会关闭任务分配入口，取消 leader，并等待其 Team 子执行清理。后续用户消息可以开启新一轮。直接发给忙碌模型的消息会在下一步接收，并保留其已有任务的归属。停止某个成员后，自动重新分配会暂停，直到下一条用户请求。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

此 bundle 组合已有 [Team service](../agent-team/README.zh.md)、[Host 运行时](../model-group-runtime/README.zh.md)与 [Client 界面](../client-ui-model-group/README.zh.md)。Team 管理成员与任务状态；运行时管理模型路由和执行控制；Client 提供群时间线、@ 和插件设置。所有成员复用已有工作区与文件服务。

Team service 使用共享的 `agent-team` 入口 id，同时选择 Agent Teams 和模型群时也只加载一次。最后选择的 bundle 提供服务初始配置；配置档覆盖项应指向 `agent-team`。取消选择其中一个 bundle 时，只要另一个仍声明此入口，服务就会保留。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Agent Teams](../agent-team/README.zh.md) — 持久成员、公共任务与成员消息投递。
- [子 Agent](../../subagent/subagent/README.zh.md) — 执行容量、续接与清理。
- [输入触发器](../../client/ui-input-trigger/README.zh.md) — 与文件、Session 引用共存的模型 @。

-----

<a id="model-experience"></a>
## 模型体验

通过[运行时的模型规则和工具](../model-group-runtime/README.zh.md#model-experience)以及 [Client 的收件人选择](../client-ui-model-group/README.zh.md#model-experience)间接影响。bundle 不添加独立模型输入。

#### KV Cache 影响

无直接影响；各选中模型保留运行时所述的历史与缓存行为。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 成员在同一进程和共享工作区内执行。并发修改同一文件需要协调。
- 成员文本在每条 assistant 消息结算后进入群时间线；leader 保留普通实时流式显示。
- Team 创建失败会永久保留该成员名称。成员初次创建失败后，请新建群会话。
- 卸载此 bundle 会停止其执行。此功能不提供分布式执行，也不会自动重放具有外部副作用的操作。

<a id="dev-note"></a>
### 开发备注

无。
