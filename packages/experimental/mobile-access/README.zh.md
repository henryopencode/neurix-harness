---
description: "运行自托管 Neurix 账号，并通过手机接入同一个桌面或 Web Agent。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-mobile-access

[English](README.md) | 中文

## 概述

在可信电脑上创建 Neurix 账号，再从手机登录并继续已有对话。电脑运行 Agent 并保留文件、工具和任务，手机显示同一套 Web 应用。在通用设置中明确连接和断开。此包不需要 iPhone 自动化运行器，也不控制其他 iOS 应用。

## 目录

- [使用此包](#use-this-package)
- [实现原理](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在已有 Web 或 Desktop profile 中加载此组合包的[覆盖配置](cordis.patch.yml)。它将侧栏的 DeepSeek 账号界面替换为 Neurix 登录，并禁用 Session 反馈导出器。侧栏展开时，入口按钮及其菜单均占满侧栏内部可用宽度。意见反馈入口保留，提示通道尚未开通，不打开外部表单。模型 API 密钥仍在“模型”中配置。卸载组合包会恢复底层 profile 的贡献项。

在电脑上打开“更多 → 登录”，使用 3–80 个字符的账号名和 12–128 个字符的密码创建首个账号。然后打开“设置 → 通用设置 → 手机连接”，选择目标网络并连接。手机连接同一 Wi-Fi 后扫码，使用这台电脑的 Neurix 账号登录。链接不包含登录凭据。Safari 可将已登录页面添加到主屏幕。手机登录通过 HttpOnly cookie 保持至配置的期限；后台重启后，手机需要重新登录。

“断开手机连接”会关闭该网络监听器及其连接，本地任务继续运行。在电脑上退出登录会撤销所有手机 Peer；在手机上退出仅撤销该手机，已有 Agent 任务仍由电脑持有。手机使用期间，电脑应保持运行和联网。[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-mobile-access)列出监听器、会话和登录限制；插件激活本身不会打开额外端口。

### 互联网访问

将 `publicUrl` 设为反向代理的 HTTPS 源地址，启用 `autoConnect` 后，后台启动或电脑账号登录时会恢复访问。互联网模式只在 `127.0.0.1` 监听后端，公布配置的 HTTPS 地址，准入其确切主机名，并独立于代理请求头为登录 cookie 设置 Secure。电脑上已有的账号、对话、审批策略和工具继续使用。

```yaml
- id: mobile-access
  config:
    port: 3081
    publicUrl: https://agent-connect.example.com/
    autoConnect: true
```

由电脑主动向自有服务器建立 SSH 反向通道，将服务器的回环端口转发至 `127.0.0.1:3081`。服务器已有的 HTTPS 代理将 HTTP 与 WebSocket 请求转发到该端口，并保留 Host 和 Origin。应固定 SSH 主机密钥，使用仅允许远程转发的独立密钥，并通过 macOS launchd 或 Windows 服务监督连接。不需要在路由器中配置端口转发。账号和 Agent 仍在电脑上运行，服务器负责转发流量；电脑断网或休眠后，恢复联网前无法访问。

未配置 `publicUrl` 时，仍可在通用设置中明确开启局域网连接；局域网 HTTP 仅适用于可信私有网络。[公开部署指南](../../../docs/user/guide/public-deployments.zh.md)说明 Host／Origin 和反向代理要求。

-----

<a id="understand-the-implementation"></a>
## 实现原理

已有后台拥有全部 Agent 会话、Remote 方法和事件流。额外的具体网卡监听器共享它的 HTTP 路由、WebSocket 升级、压缩和 TLS 配置。Connection 在查询注册的账号认证提供方之前，仍执行 Host／Origin 校验。每次手机登录拥有独立的 owner Peer，退出登录、到期、断开和卸载都会撤销它。网络端口与信任注册一同撤回。

私有凭据提供方保存一份所有者记录，其中包含加盐的 scrypt 密码派生密钥和电脑登录状态。密码与会话令牌不会进入 Session 日志或模型请求。手机会话令牌随机生成，只以哈希形式保存在内存中，绑定访问地址并限制数量。密码校验串行执行，设有有限的准入队列和登录失败冷却时间。首次创建账号只能通过已经认证的本地安装 API 进行，公开的手机路由仅接受登录。

-----

<a id="further-exploration"></a>
## 进一步探索

- [Connection](../../client/connection/README.zh.md)——共享的认证 Remote 传输。
- [Web server](../../host/webserver/README.zh.md)——路由、监听器与 TLS。
- [凭据](../../credentials/credentials-local/README.zh.md)——私有记录持久化。

<a id="model-experience"></a>
## 模型体验

无，因为账号登录和手机传输不会贡献模型可见上下文。

#### KV 缓存影响

不改变模型请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **账号范围**——一个所有者账号属于当前 Harness home。尚无统一账号目录、账号恢复或多电脑的服务器设备列表。在其他电脑上创建相同名称，不代表相同身份。
- **部署**——反向通道、公开 DNS、证书续期和 HTTPS 代理由部署方持有。插件配置本地后端与公开账号访问地址，不获取服务器凭据，也不唤醒休眠的电脑。局域网发现列出 IPv4 网卡。
- **移动端后台**——iOS 可能挂起页面。电脑会继续任务，Web 客户端通过已有连接监督器恢复；此包不增加手机后台执行或推送通知。

<a id="dev-note"></a>
### 开发备注

无。
