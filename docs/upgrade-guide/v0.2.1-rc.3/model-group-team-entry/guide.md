---
kind: upgrade-guide
description: "The Model groups bundle uses the shared agent-team entry instead of model-group-team for Team service configuration."
---

# Model groups Team service entry

English | [中文](guide.zh.md)

## Change

The Model groups bundle names its Team service entry `agent-team` instead of `model-group-team`. Agent Teams and Model groups share this entry when both bundles are selected. Existing patches targeting `model-group-team` must use `agent-team`.

## Migration

1. In `$DSH_HOME/profiles/<profile>/cordis.patch.yml`, the home-level `cordis.patch.yml`, and launch overlays, change Team service patch ids from `model-group-team` to `agent-team`. Keep the service's configuration values.
2. When both bundles are selected, place shared Team limits in one `agent-team` profile override; it takes precedence over either bundle's initial configuration.
3. Reload or restart the profile. Confirm that Team collaboration is running without an `agentTeams` duplicate-registration warning. Model groups can be enabled alone or alongside Agent Teams.
