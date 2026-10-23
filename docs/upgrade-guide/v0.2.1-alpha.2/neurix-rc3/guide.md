---
kind: upgrade-guide
description: "Neurix Harness requires Node.js 24.9 or newer and adopts the upstream model and Session compatibility changes in 0.2.1-rc.3."
---

# Upgrade Neurix Harness to 0.2.1-rc.3

English | [中文](guide.zh.md)

## Change

Neurix Harness incorporates the upstream 0.2.1-rc.3 runtime while retaining its image generation, unified computer control, turn bookmarks, and branding. Package names, the `dsh` command, and the default `~/.dsh` data directory remain unchanged. The repository retains its independent commit history.

Source installations require Node.js 24.9 or newer. The pi-ai model catalog removes some model IDs and changes capacities. Ordinary Session forks become independent Sessions; older V4 readers can reject new fork logs. HTTP fetching permits private-network destinations. The upstream experimental Computer Use and recommendation bundles remain optional.

## Migration

1. Stop running instances and back up your Harness home. If `DSH_HOME` is set, back up that directory; otherwise back up `~/.dsh`. Upgrade every process that shares its Session directory before creating or opening new forks.
2. Select Node.js 24.9 or newer. With nvm, run `nvm use` in the checkout to select the version pinned by `.nvmrc`, then confirm it with `node --version`.
3. Run `pnpm install` and `pnpm run build`. Launch your usual profile with `pnpm dsh web` or its existing launcher.
4. Check your model selection against the [model catalog migration](../../v0.2.1-rc.2/pi-ai-model-catalog/guide.md). Check custom plugins against the [tool execution](../../v0.2.1-rc.2/tool-executor-plugins/guide.md) and [model selection](../../v0.2.1-alpha.4/session-model-selection/guide.md) changes.
5. Review the [HTTP fetch network policy](../../v0.2.1-rc.2/web-fetch-private-destinations/guide.md) if your deployment restricts access to private services. Check the [fork reader requirements](../../v0.2.1-rc.3/independent-session-forks/guide.md) before sharing new logs with older installations.
6. Confirm that an existing conversation opens, your configured model responds, and your image generation, computer control, and bookmarks remain available. These integrations retain their saved configuration and explicit activation.
