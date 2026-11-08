---
description: "在会话页头的项目打开控件旁显示当前 Git 分支。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-git-branch

[English](README.md) | 中文

## 摘要

在会话页头的项目打开控件前查看当前会话目录的 Git 分支。标签会跟随分支变化，支持链接工作树，使用短提交号标识分离 HEAD；目录不属于仓库或 Git 不可用时不显示。插件只读取仓库元数据，不修改文件、索引或检出状态。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

Web 组合包包含此插件。点击标签或使用键盘聚焦可查看完整的长分支名。读取失败时，标签会显示本地化的重试控件；重试成功后恢复当前元数据。

| 配置 | 默认值 | 含义 |
|---|---|---|
| `timeoutMs` | `5000` | 单次 Git 观察的截止时间 |
| `refreshMs` | `5000` | 页头订阅期间两次观察的间隔 |

<a id="understand-the-implementation"></a>
## 理解实现

Host 拥有 `gitBranch.follow` Remote 流。现有工作区文件 Session 查询负责授权和目录解析，不激活 Agent。Git 通过已组合的子进程提供方执行，输出受限且支持取消。Client 注册 `git-branch` 资源并通过 `useResource` 读取；页头释放后停止订阅。标签使用现有会话工具控件插槽、本地化文案和共享图标。插槽与资源的所有权参见 [Web 客户端参考](../../../docs/subsystems/web-client.zh.md)。

<a id="model-experience"></a>
## 模型体验

无，分支元数据只用于界面，不会加入模型请求或 Session 事件。

#### KV Cache 影响

无；本插件不组装或发送模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 外部 Git 命令切换分支后，标签在下一次观察时更新，而非同步更新。
- 标签只标识当前分支，不提供切换分支或未提交改动计数。

<a id="dev-note"></a>
## 开发备注

无。
