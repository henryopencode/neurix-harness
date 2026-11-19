---
kind: upgrade-guide
description: Web search requires an explicit provider choice instead of defaulting to DeepSeek.
---

# Web search is opt-in

English | [中文](guide.zh.md)

## Change

Profiles using the base bundle default to `web.searchProvider: none` instead of `deepseek-search-api`. Search is independent of the chat model: switching models neither enables search nor changes its provider. HTTP fetch remains enabled with `web.fetchProvider: http`. Existing settings and profile overrides remain authoritative; credentials are not changed.

Both provider menus offer **Disabled**. The reserved value `none` makes readiness return false and direct operations fail with `WEB_PROVIDER_DISABLED` before consulting a provider. Plugins cannot register the id `none`; registration fails with `WEB_PROVIDER_RESERVED_ID`. Omitted configuration still auto-selects exactly one usable provider.

## Migration

1. To enable search, select a trusted provider in **Plugins → Web search and fetch → Web search provider**, then save. DeepSeek Search API remains an opt-in; it requires its own supported endpoint and DeepSeek credentials, not an unrelated chat model's key.
2. For a profile patch, restate both selections because a patch replaces the row's entire configuration:

   ```yaml
   - id: web
     name: '@deepseek-ai/dsh-web'
     config:
       searchProvider: deepseek-search-api
       fetchProvider: http
   ```

3. To stop an existing DeepSeek selection, choose **Disabled**, or use `searchProvider: none` in that patch. Check the effective choice after restarting the profile; disabled search is absent from model requests, while HTTP fetch remains available.
4. A custom provider named `none` must use another id, and any selection of that provider must use the new id.
