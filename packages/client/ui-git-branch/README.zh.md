---
description: "输入框上方的 Git 分支显示与本地分支切换。说明切换保护、共享工作树的影响和刷新行为。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-git-branch

[English](README.md) | 中文

## 概述

在输入框上方查看工作目录和当前 Git 分支，搜索本地分支并直接切换。空白会话在工作区栏中使用同一个分支菜单。Git 保留常规的文件冲突和工作树占用检查，并拒绝覆盖被忽略的文件。共享工作树的所有会话使用同一份检出状态。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [继续探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

内置 Web bundle 挂载此插件。它需要会话、Agent、子进程、沙箱、本地化、资源、槽位和生成的 Remote 服务；Host 与浏览器两端一起加载。非 Git 目录不显示控件。分离 HEAD 显示简短提交号，尚无提交的仓库显示符号分支名。

菜单标记当前分支，并禁用已由其他工作树检出的分支。切换会改变工作树文件，因此菜单提示其对其他会话的影响。同一根目录或其子目录有正在运行的 Agent 时，Host 拒绝切换，并在修改前检查用户看到的检出状态。插件不会暂存、丢弃更改、创建分支、推测远端分支或运行检出钩子。Git 过滤器仍在会话沙箱策略下运行。Git 拒绝切换时保留当前界面并显示本地化 Toast；取消或切换后检查失败时，需要检查分支和工作区文件，因为检出可能已经完成。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `timeoutMs` | `15000` | 单条 Git 命令的截止时间 |
| `maxOutputBytes` | `1048576` | 每路输出的捕获字节上限，超限报错 |
| `graceMs` | `1000` | 终止宽限时间 |
| `refreshIntervalMs` | `3000` | 外部 Git 变更的观察间隔 |

使用 Apple 的 Git 启动器前会检查是否已选择开发者工具；缺少工具时显示可重试的读取失败，不打开安装器。

分支控件与恢复提示在全部八种内置语言中跟随当前界面语言。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Host 的 `workspaceGit` Remote 服务解析调用者有权访问的活动会话，并使用该会话的工作目录和沙箱策略。浏览器的 `git-branch` 资源持有观察流，通过 Remote 监督器重连，并在最后一个持有者离开时释放。成功切换会唤醒同一工作树根目录的观察者。外部变更在下一次观察时出现；读取失败保留最后一次值并提供重试。操作 Toast 位于 `shell.overlay`，离开会话页面后仍可看到结果。

</details>

-----

<a id="further-exploration"></a>
## 继续探索

- [会话](../../../docs/subsystems/conversation.zh.md) — 会话组合。
- [客户端资源](../../../docs/subsystems/client-resources.zh.md) — 观察流的所有权。
- [在应用中打开](../ui-open-in-app/README.zh.md) — 相邻的目录控件。

-----

<a id="model-experience"></a>
## 模型体验

无，因为此包提供供用户操作的 Git 控件，不增加模型输入。

#### KV Cache 影响

无；插件不组装或发送模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 只能选择已有本地分支。获取远端更新、创建远端分支、暂存和解决合并冲突仍需通过其他 Git 操作完成。
- 运行检查覆盖 Harness Agent 和其他会话；外部程序以及检查通过后启动的 Agent 仍可能并发修改文件。
- 组合的子进程提供程序环境必须安装 Git。读取失败时提供重试，不将无法读取的仓库当成非 Git 目录。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

Git 读取和切换共用组合的子进程执行环境；直接读取本地文件系统会让 SSH 提供程序检查错误的仓库。

</details>
