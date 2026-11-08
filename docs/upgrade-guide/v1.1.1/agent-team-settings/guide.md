---
kind: upgrade-guide
description: "Agent Teams removes candidate-model settings and direct addressing commands."
---

# Agent Teams settings

English | [中文](guide.zh.md)

## Change

Agent Teams uses its original member and shared-task panel. The `models`, `leaderModel`, and `maxParallel` settings and the `/team tell` and `/team stop` commands are removed. Teammates inherit the Lead's model. Existing Session event types remain readable.

## Migration

1. Remove `models`, `leaderModel`, and `maxParallel` from the `agent-team` entry in your profile patch. Use `maxMembers` to limit the total teammate count.
2. Ask the Lead to assign work through the existing Team tools, and open **Agent Teams** to inspect members and shared tasks.
