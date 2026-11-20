---
kind: upgrade-guide
description: "Model groups is no longer shipped, and profiles drop its bundle selection on load."
---

# Model groups retired

English | [中文](guide.zh.md)

## Change

The Model groups plugin, its conversation mode, and the `/model-group` command are no longer available. Profiles automatically drop `@deepseek-ai/dsh-experimental-model-group` from `dsh.profile.bundles` on load. Existing conversations still open, and model group events remain in their Session logs.

## Migration

1. If you added a `model-group` or `model-group-ui` override to `cordis.patch.yml`, remove it. Remove any explicit Model groups plugin entries from custom `cordis.yml` files.
2. Open the profile and check that Model groups is gone from Plugins. You can use [Agent Teams](../../../subsystems/agent-team.md) for collaboration in new conversations.
