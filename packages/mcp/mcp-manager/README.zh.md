---
description: "查看 MCP 连接及工具、编辑服务器配置并恢复失败的配置修改。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-manager

[English](README.md) | 中文

## 概述

通过经过认证的 Remote 方法管理全局 MCP 服务器配置，查看受监督的连接状态及工具。已有的本机全局连接会直接显示，无需导入配置。认证信息保留在 Host 中；认证字段留空时会保留已有值。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Web 或 Desktop 侧栏打开 [MCP 页面](../../client/ui-mcp/README.zh.md)。添加服务器时填写启动命令和每行一个的参数，或选择 Streamable HTTP 并填写端点。环境变量和请求头接受键值均为字符串的 JSON 对象；留空保留已有值，输入 `{}` 则清空。修改对本机所有 profile 生效。移除连接不会删除远程文档。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `refreshIntervalMs` | `1000` | 页面打开时连接状态快照的读取间隔。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者工作上下文——点击展开</summary>

页面通过共享 MCP 注册表及生成的 Remote 贡献读取连接所有者提供的状态。Host 读取有效的 Loader 条目，仅编辑 `$DSH_HOME/cordis.patch.yml` 中的 MCP 声明或覆盖项，保留其他条目、注释和 JavaScript 标签。配置版本用于拒绝过期编辑。文件锁与 HMR 串行化避免重叠写入；重新应用失败时恢复原文件和组合。恢复失败后会停用进一步写入，需检查配置再重启。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [MCP](../../../docs/subsystems/mcp.zh.md)
- [MCP client](../mcp-client/README.zh.md)
- [MCP resources](../mcp-resources/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

### MCP 配置

#### 模型看到什么

本服务不注册模型可见工具或提示词段落。连接的服务器提供 `mcp__<serverName>__<tool>` 工具。添加或停用服务器会改变该 MCP 客户端提供的工具和指令。

#### Token 影响

读取连接状态不增加模型请求内容；服务器修改的 token 影响由 [MCP 客户端](../mcp-client/README.zh.md#model-experience)定义。

#### KV Cache effect

读取连接状态本身没有影响。服务器修改遵循 MCP 客户端的工具和系统提示词行为。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 页面管理全局服务器；Agent 预设和嵌套 Include 声明仍由其配置所有者管理。
- 使用表达式的连接会显示，但需在配置文件中编辑。
- 部署提供的服务器可停用或覆盖；只有全局用户配置中声明的服务器可移除。
- 保存成功表示配置已应用；连接状态单独表示服务器是否可访问。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
