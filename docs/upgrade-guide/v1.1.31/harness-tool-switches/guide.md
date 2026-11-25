---
kind: upgrade-guide
description: "Harness tools replaces the terminal launch and resume buttons with switches for Agent delegation."
---

# Harness tools switches

English | [中文](guide.zh.md)

## Change

**Settings → Harness tools** now controls whether the Agent can use Codex and Claude Code. The Settings page removes the terminal installation check and the **Start** and **Resume** buttons.

## Migration

1. To delegate work, turn on **Codex** or **Claude Code** in **Settings → Harness tools**. Desktop and the packaged Web server supply both providers. Ask the Agent to use the tool in a conversation and expand the run to verify its activity.
2. To open the CLI yourself, open a workspace terminal. Enter `codex` or `claude` to start, or `codex resume` or `claude --resume` to open the product's session picker.
