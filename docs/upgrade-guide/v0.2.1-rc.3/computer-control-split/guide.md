---
kind: upgrade-guide
description: "Computer Control splits into native Application control and isolated Browser control."
---

# Separate browser and application control

English | [中文](guide.zh.md)

## Change

The optional Computer Control bundle becomes **Application control** and retains its package name and `computer-control` settings entry. Its tool is `application`, supports macOS native windows including browser apps, and always uses foreground system input. **Browser control** is a separate optional bundle with a `browser` tool, its own approval and preview, and an independent hidden Playwright session. Both plugins can run together.

## Migration

1. Keep Application control enabled for native applications. Update tool integrations from `computer` to `application` for this bundle.
2. Enable **Browser control** in Plugins for isolated web tasks, or add `@deepseek-ai/dsh-experimental-browser-control` to your profile bundles. Use the `browser` tool.
3. Move browser-only overrides (`browserChannel`, `browserViewportWidth`, `browserViewportHeight`) from `computer-control` to `browser-control`. Remove `headless`; browser sessions always run hidden. Set each plugin's `requireInputApproval` independently.
4. Save settings and start a new conversation. Confirm the selected plugin exposes only its own operations and preview. Standalone unified-provider compositions retain their `computer` tool and mode settings.
