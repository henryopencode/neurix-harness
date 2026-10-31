---
description: "通过专属链接和二维码，让手机接入同一个桌面或 Web Agent。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-mobile-access

[English](README.md) | 中文

## 概述

通过专属链接或二维码，在手机上继续这台电脑的 Agent 对话，无需创建账号。在“扩展工具”中打开“手机连接”插件，即可开启访问、复制链接或更新链接。电脑保留文件、工具和任务，需保持运行和联网。此包不需要 iPhone 自动化运行器，也不控制其他 iOS 应用。

## 目录

- [使用此包](#use-this-package)
- [实现原理](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发笔记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在“插件 → 扩展工具 → 手机连接”中启用此插件，或将其[叠加层](cordis.patch.yml)加载到现有 Web 或桌面配置中。它移除侧栏的 DeepSeek 账号界面并禁用会话反馈导出器。底部设置齿轮打开本地设置与意见反馈菜单；意见反馈不打开外部表单。模型 API 密钥仍在“模型”中配置。卸载此插件可恢复底层配置的贡献。面板及其提示使用当前界面语言。

打开插件配置页并开启连接，扫码或将完整链接复制到手机。局域网模式要求同一网络；配置互联网地址后支持流量和任意 Wi-Fi。链接片段包含 256 位随机访问密钥，浏览器通过同源请求正文将其换成 HttpOnly 会话 Cookie，然后从浏览器历史中移除。持有完整链接即可控制 Agent，请妥善保管。

重新打开面板、重连和重启 Host 都保留已保存的密钥。“更新链接”生成新密钥，并撤销此前所有手机 Cookie 和活动 Peer。“关闭连接”撤销手机授权并关闭监听器，电脑上的 Agent 任务继续运行。再次开启连接时复用原密钥。浏览器会话独立过期；重新打开保存的链接即可接入。手机可断开自身连接，但无法通过插件 API 读取或修改电脑的连接链接。

### 互联网访问

将 `publicUrl` 设为反向代理的 HTTPS 源站地址，并启用 `autoConnect`，以便 Host 启动时恢复连接，同时尊重已保存的关闭状态。互联网模式仅在 `127.0.0.1` 监听，展示配置的 HTTPS 地址，准入其精确主机名，并独立于代理请求头为手机 Cookie 设置 Secure。它保留电脑的已有对话、审批策略和工具。

```yaml
- id: mobile-access
  config:
    port: 3081
    publicUrl: https://agent-connect.example.com/
    autoConnect: true
```

在电脑上建立到自有服务器的出站 SSH 反向隧道，将服务器环回端口转发至 `127.0.0.1:3081`。服务器的 HTTPS 代理将 HTTP 和 WebSocket 请求转发到该端口，同时保留 Host 和 Origin。固定 SSH 主机密钥，使用限制为远程转发的独立密钥，并通过 macOS launchd 或 Windows 服务监护连接。无需路由器端口转发。Agent 在电脑上运行，服务器转发流量。电脑断网或睡眠时无法访问，直到它恢复在线。

未配置 `publicUrl` 时使用局域网模式，需在插件页面明确开启连接。局域网 HTTP 仅适用于可信私有网络。[公开部署指南](../../../docs/user/guide/public-deployments.zh.md)定义 Host/Origin 和反向代理要求。

-----

<a id="understand-the-implementation"></a>
## 实现原理

现有 Host 拥有全部 Agent 会话、Remote 方法和事件流。附加监听器共享其 HTTP 路由、WebSocket 升级、压缩和 TLS 配置。Connection 在查询链接会话认证提供者前检查 Host 和 Origin。每台手机获得独立的 owner Peer；断开、过期、更新链接和卸载都会撤销它。网络监听器与源站准入注册一起撤销。

私有凭据提供者保存链接密钥和访问开关。激活时移除本插件已停用的 Neurix 所有者账号记录，同时保留其他凭据。密钥不进入 Session 日志或模型请求。浏览器会话令牌为随机数，仅以哈希保存在内存中，绑定精确源站并限制数量和时长。监听器操作和链接更新串行执行；持久化失败时保留此前发布的链接。

-----

<a id="further-exploration"></a>
## 进一步探索

- [连接](../../client/connection/README.zh.md) — 共享的认证 Remote 传输。
- [Web 服务器](../../host/webserver/README.zh.md) — 路由、监听器和 TLS。
- [凭据](../../credentials/credentials-local/README.zh.md) — 私有记录持久化。

<a id="model-experience"></a>
## 模型体验

无；手机连接和传输不贡献模型可见上下文。

#### KV Cache 影响

不改变模型请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **链接范围** — 一个连接密钥属于此 Harness 主目录。此包不提供中心化设备目录、账号系统或链接恢复服务。
- **部署** — 反向隧道、公开 DNS、证书续期和 HTTPS 代理由部署方负责。插件配置本地后端和公开连接源站，不获取服务器凭据，也不能唤醒睡眠电脑。局域网发现仅列出 IPv4 接口。
- **移动端后台** — iOS 可能挂起页面。电脑继续执行任务，Web 客户端通过已有连接监护恢复；此包不增加后台执行或推送通知。

<a id="dev-note"></a>
### 开发备注

无。
