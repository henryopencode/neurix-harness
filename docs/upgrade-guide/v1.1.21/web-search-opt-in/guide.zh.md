---
kind: upgrade-guide
description: 网页搜索必须显式选择提供方，不再默认使用 DeepSeek。
---

# 网页搜索改为显式启用

[English](guide.md) | 中文

## 变更

使用基础组合包的 profile 默认采用 `web.searchProvider: none`，替代 `deepseek-search-api`。搜索与聊天模型独立：切换模型既不启用搜索，也不改变搜索提供方。HTTP 获取仍以 `web.fetchProvider: http` 启用。现有设置与 profile 覆盖仍然生效；凭据不会改变。

两个提供方下拉框都提供**已停用**。保留值 `none` 使就绪判断返回 false，直接调用在询问提供方之前以 `WEB_PROVIDER_DISABLED` 失败。插件不能注册 id `none`，否则注册以 `WEB_PROVIDER_RESERVED_ID` 失败。省略配置时仍只在恰好一个提供方可用时自动选择。

## 迁移

1. 要启用搜索，请在**插件 → 网页搜索与获取 → 网页搜索提供方**中选择可信提供方并保存。DeepSeek Search API 仍可显式启用；它需要自身支持的端点和 DeepSeek 凭据，而非其他聊天模型的密钥。
2. 使用 profile patch 时，请重述两个选择，因为 patch 会替换该行的整个配置：

   ```yaml
   - id: web
     name: '@deepseek-ai/dsh-web'
     config:
       searchProvider: deepseek-search-api
       fetchProvider: http
   ```

3. 要停止现有 DeepSeek 选择，请选择**已停用**，或在上述 patch 中使用 `searchProvider: none`。重启 profile 后检查生效选择；停用的搜索不出现在模型请求中，HTTP 获取仍可用。
4. 名为 `none` 的自定义提供方必须更换 id，并将对应选择改为新 id。
