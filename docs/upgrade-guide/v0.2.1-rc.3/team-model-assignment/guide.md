---
kind: upgrade-guide
description: "Move standalone model-group configuration into Agent Teams and select models through normal teammate responsibilities."
---

# Team model assignment

English | [中文](guide.zh.md)

## Change

Agent Teams supports a configured model pool and a Lead model. The Lead creates task-specific responsibilities with `spawn_teammate`, choosing a `model` alias separately from the role name and description. Configured model pools require an explicit candidate alias; calls without a configured pool retain inherited model selection.

The standalone Model groups entry is hidden from the main plugin list. Its separate mode selector and assignment tools are absent from the unified Team workflow. Historical reply records remain readable.

## Migration

1. Select `@deepseek-ai/dsh-experimental-agent-team-profile` in the profile's `package.json` bundle list and deselect `@deepseek-ai/dsh-experimental-model-group`.
2. Move the `model-group` patch configuration into `agent-team`: rename `members` to `models` and `leader` to `leaderModel`, keep `maxParallel`, and remove `defaultMode`. Preserve candidate provider routes, exact model ids, labels, and strengths. Existing Team deployment limits can remain in the same configuration.
3. Save and restart or reload the profile. In Team plugin details, check the Lead model and candidates. Use a fresh conversation to exercise role-specific model assignment; existing conversations retain their histories and captured choices.
4. Change explicit model tools from `model_group_assign` to `spawn_teammate` with `name`, `description`, `prompt`, and `model`. Human controls use `/team tell <member-or-model> <message>` and `/team stop [member]`.
