---
kind: upgrade-guide
description: "Custom MCP and named-teammate integrations use separate services, and the fixed 1017 model badge package is removed."
---

# Upstream plugin services and model badges

English | [中文](guide.zh.md)

## Change

The built-in MCP configuration page uses `@deepseek-ai/dsh-mcp-config-manager`, exposed as `ctx.mcpConfigManager` and `remote.mcpConfigManager`. `@deepseek-ai/dsh-mcp-manager` supplies the upstream settings-driven server fleet. Shipped Web and Desktop compositions select both packages; existing MCP client declarations remain in their profile patches.

The optional `@deepseek-ai/dsh-experimental-agent-team-profile` retains named teammates and the chronological Team view through `ctx.legacyAgentTeams` and the `legacyAgentTeam` projection. Enabling this bundle replaces the built-in Team mode in that profile. The upstream Team mode uses `ctx.agentTeams` and the `agentTeam` projection. Existing Team log records retain their event names and data.

Custom plugins and explicit profile overrides that reference the former service names need the following updates. Selecting the existing optional Team bundle requires no manual profile rewrite.

The fixed `@deepseek-ai/dsh-client-ui-deepseek-model-label-1017` package is removed. Model catalogs supply optional badges; the selector no longer adds `1017` independently.

## Migration

1. For an MCP configuration-editor row, change its package to `@deepseek-ai/dsh-mcp-config-manager` and its id to `mcp-config-manager`. Update editor imports, remote calls, and access checks from `mcpManager` to `mcpConfigManager`. Keep `@deepseek-ai/dsh-mcp-client` server rows unchanged.
2. In integrations with the optional named-teammate bundle, replace `ctx.agentTeams` with `ctx.legacyAgentTeams` and read `legacyAgentTeam`. Custom row overrides use `legacy-agent-team`, `legacy-tool-agent-team`, and `legacy-ui-agent-team`. Keep the optional bundle's package name unchanged.
3. Open the MCP page and the Team view after restarting the profile. Verify existing server declarations and recorded teammate messages are visible before submitting new work. For the upstream pull-request panel, enable **Change requests and worktrees** in Plugins.

4. Remove `ui-deepseek-model-label-1017` row overrides and dependencies on its package. The [model badge guide](../../v0.2.1-rc.2/model-badge-package-removal/guide.md) covers custom label contributions. Restart and confirm that the model selector uses the catalog names and badges without a missing-row warning.
