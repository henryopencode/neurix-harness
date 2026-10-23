---
kind: upgrade-guide
description: "Desktop application paths and installer filenames use Neurix Harness branding."
---

# Desktop application and installer names

English | [中文](guide.zh.md)

## Change

The desktop application is named `Neurix Harness`. Its macOS bundle is `Neurix Harness.app`, and installer artifacts use the `neurix-harness-` prefix. Shortcuts and scripts that name the previous application or installer file must use the new filename. Existing npm package names, the `dsh` command, `DSH_HOME`, and the Harness data directory names remain unchanged.

## Migration

1. Install the Neurix Harness desktop application for your platform.
2. Update shortcuts and scripts that refer to `DeepSeek Harness.app` to refer to `Neurix Harness.app`; update installer filename references from `deepseek-harness-` to `neurix-harness-`.
3. Open the application and check that its About panel displays `Neurix Harness`. Continue using your existing `dsh` command and Harness home.
