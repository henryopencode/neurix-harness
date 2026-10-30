---
kind: upgrade-guide
description: "手机连接以专属连接链接替代实验性的 Neurix 账号。"
---

# 手机连接使用专属链接

[English](guide.md) | 中文

## 变更

实验性 mobile-access 插件移除 Neurix 账号注册、登录和 `neurixAccount` Remote 命名空间。配置入口从通用设置移至“插件 → 扩展工具 → 手机连接”。原有手机 Cookie 被撤销。插件移除已停用的 `neurix-account/owner` 凭据记录，同时保留模型提供者凭据和 Agent 对话。

## 迁移

1. 从 `mobile-access` 配置中移除 `loginFailedAttempts`、`loginCooldownMs` 和 `maxPendingLogins`。按需保留 `port`、`publicUrl`、`autoConnect`、`sessionMaxAgeMs` 和 `maxPhoneSessions`。
2. 在电脑上打开“手机连接”并开启访问。复制完整链接或扫描二维码，手机无需账号密码即可进入同一个 Agent。
3. 保存专属链接。其随机密钥在重启和重连后保留。“更新链接”会替换密钥并断开所有手机；关闭连接保留密钥，但停止远程访问。
4. 将自定义账号 API 调用方改为使用 `mobileAccess.describe`、`watch`、`open`、`close` 和 `regenerate`。手机通过 `POST /neurix/disconnect` 断开自身连接；只有电脑本地浏览器可以管理连接链接。
