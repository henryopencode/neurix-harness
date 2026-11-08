---
description: "Web 客户端的模型群设置、会话模式、定向模型 @ 和带署名的成员消息。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-model-group

[English](README.md) | 中文

## 概述

在插件详情中选择模型和 leader，切换单个会话的单模型或模型群模式，并通过 `@` 定向联系模型。群内展示模型活动、公开回复与停止操作。启用[模型群 bundle](../model-group/README.zh.md)，即可同时加载运行时与此界面。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

bundle 持有插件页面入口。详情页暂存成员选择、擅长描述、leader、并行上限和默认模式，直到点击保存。当前目录中不存在的已保存模型仍可编辑和移除。目录读取失败会保留最近可用结果，并提供重试。

各会话通过共享 Session 投影读取自身记录的模型群配置。成员按钮插入精确别名；输入触发源解析模型 @，并保留文件和 Session 引用。定向消息通过经过鉴权的命令投递，普通消息保留常驻 composer。部分投递和停止失败保持可见。群消息显示在折叠的工具详情之外。

模型控制项位于输入框上方的单行栏中，窗口较窄时可以横向滚动。空闲时显示模型名称和 leader 标记，执行时显示活动状态与带悬浮提示的成员停止图标。输入框的停止按钮会停止整组模型，仅成员运行时仍可使用。停止失败会显示在成员旁或输入框中。

成员回复使用带边框的消息块，并显示完整模型名称。模型群模式下，常驻 Assistant 的回复显示组长名称和标记。任务操作显示本地化的动作和目标摘要；原始输入和结果可展开查看。历史分配消息折叠为任务指令，模型失败保留对应模型名称和重试提示。

定向消息以“已发送给”展示已接收的收件人，与成员执行状态分开。`@` 菜单区分模型定向与成员、历史 Session 记录引用，两种操作均保留。成员详情保持由模型群管理的模型选择，不显示根会话的模式控制。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Client 插件通过 Conversation 插槽注册本地化控制项、按键匹配的聊天消息渲染器、输入触发源和 bundle 配置组件。控制项与设置支持所有随产品提供的界面语言。成员选择读取普通模型选择器的同一份已配置模型目录，并同步提供商、凭据与连接更新。暂存配置由实例控制器持有，卸载会注销界面贡献。现有 Session、工作区、附件和文件服务保留各自的所有权。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 定向模型消息

#### 模型看到什么

`@model-name` 等模型 @ 选择接收模型。[运行时](../model-group-runtime/README.zh.md) 在模型执行前记录原始文本与已接收的附件。普通消息保留原有提交路径。

#### Token 影响

每个选中模型在自己的历史中接收一次任务输入。渲染的群消息和控制项不增加模型 token。

#### KV Cache 影响

定向输入追加在接收模型持久化的前缀之后。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 成员文本在每条 assistant 消息结算后显示。
- 成员工具执行详情复用现有子 Session 视图。
- 群不提供独立文件系统或私有消息历史。

<a id="dev-note"></a>
### 开发备注

无。
