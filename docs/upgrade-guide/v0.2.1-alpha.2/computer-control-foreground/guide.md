---
kind: upgrade-guide
description: "Computer Control background mode supports browser tabs only; desktop applications require explicit foreground mode."
---

# Computer Control background mode is browser-only

English | [中文](guide.zh.md)

## Change

Computer Control defaults to `inputMode: background`, labelled **Browser background only**. This mode does not discover, launch, observe, or send input to desktop applications. Desktop access requires the user's explicit selection of **Foreground system input**. Input mode and approval changes apply to the next operation in existing conversations; other runtime defaults remain captured on first use. Browser JavaScript dialogs retain background feedback.

The bundle sets the unified provider's `nativeBackground` option to false. Direct unified-provider profiles retain experimental native background access by default. Native pixel click and typing fail before dispatch because the SDK can activate the target even when the requested delivery mode is background. A background receipt does not prove that window focus stayed unchanged.

## Migration

1. Use **Browser background only** for browser tasks. For desktop tasks, select **Foreground system input** in Plugins → Extension tools → Computer Control and save. The setting does not switch automatically.
2. List targets again after changing modes. `capabilities.native: false` with `nativeForeground: true` means foreground mode can expose desktop operations. `NATIVE_FOREGROUND_REQUIRED` means no desktop operation was dispatched; stop native attempts until the user changes mode.
3. The CLI example patch also sets `nativeBackground: false`. Set `inputMode: foreground` under its provider's `config` for desktop tasks. Profiles using the unified provider directly can retain experimental accessibility routes with `nativeBackground: true`; native pixel click and typing still fail with `BACKGROUND_PIXEL_UNAVAILABLE` before input.
4. Treat `inputMode` as the requested setting. Verify the intended UI result and actual focus independently. Foreground actions occupy the desktop; **Stop generating** cancels further input while already delivered input remains.
