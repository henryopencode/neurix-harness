---
kind: upgrade-guide
description: "Knowledge is enabled by default in base-backed profiles, replacing the experimental opt-in bundle."
---

# Knowledge is built in

English | [中文](guide.zh.md)

## Change

The base-backed profiles mount document knowledge by default. Web and Desktop provide a fixed sidebar entry; the Plugins page does not offer an activation switch. Files remain under `$DSH_HOME/storages/knowledge-base`, with the same document identities and revisions. Nothing is imported automatically.

The service package is `@deepseek-ai/dsh-knowledge-base`; the page is `@deepseek-ai/dsh-client-ui-knowledge-base`. The previous experimental packages are replaced by these product packages.

## Migration

1. Start each existing profile once. Loading removes `@deepseek-ai/dsh-experimental-knowledge-base` from its selected bundles while preserving other manifest fields. The default composition supplies the capability.
2. Custom compositions replace experimental package names with the product names above. Preserve `knowledge-base` configuration overrides and the existing storage path. The API dashboard adds `availability` (`ready` or `unsupported-platform`).
3. Confirm the sidebar entry is visible without enabling a plugin and existing documents remain readable. Intel macOS keeps the application and management page available, with an explicit unsupported-platform state for indexing.
