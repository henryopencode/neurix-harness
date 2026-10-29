---
description: "Enable browser and macOS control from Plugins and configure defaults."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-computer-control

English | [中文](README.zh.md)

## Summary

Enable computer control from Plugins → Extension tools. Configure a browser, screenshot mode, and timeouts, then use computer control in a new conversation. Browser tabs and macOS windows use the same `computer` tool. The plugin is offered disabled and opens a separate browser profile. Native application access requires the launching host’s macOS permissions.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open Plugins → **Extension tools** → **Computer Control**. Turn on the plugin with its switch, then open its detail page. Its experimental badge describes release status; the card remains beside Image Generation while switched off. Disable the plugin to remove its tool and close its owned browser resources.

The default **Browser background only** mode operates browser tabs. Desktop applications require an explicit selection of **Foreground system input**; this bundle does not expose experimental native background control. Enable **Show agent cursor and key indicators** to see its actions. **Stop generating** cancels further input; already delivered actions remain. Desktop discovery, launch, and input stop with `NATIVE_FOREGROUND_REQUIRED` in browser-only mode, before desktop access starts. Choose the installed browser; leave **Hide browser windows** off to watch its page. Screenshots default off so text models can start with accessibility state. Enable screenshots only for a model that supports image input. Native screenshots need the host’s Screen & System Audio Recording permission; native actions need Accessibility. Browser screenshots use Playwright.

**Startup and navigation timeout** covers native application launch as well as browser startup and navigation. Runtime defaults are captured on first use. Input mode changes apply to the next operation in existing conversations; other defaults require a new conversation. Open tabs remain available. Fields show effective values without override badges or reset actions. Invalid values remain in the form, and a refused save retains drafts.

**Ask before each computer action** defaults off and takes effect immediately in all conversations. When enabled, every action except listing and observation needs a separate one-shot approval; an unavailable approval channel blocks input. This setting does not create domain or application restrictions.

When the agent selects a target, **Computer picture-in-picture** appears in the conversation’s upper-right corner with the actual target image, software cursor, and action status. The browser scroll duration setting controls native continuous wheel gestures. Active previews refresh more often during input. The native accessibility read budget is editable for applications with large control trees. Visible macOS browser pages and native apps share an independent window overlay; the same cursor, click, drag, keyboard and scroll state drives their previews. Typing shows the current delivered key; before delivery, only the keyboard icon appears. Browser dialogs use the full host-window image so button coordinates align. Scrolling shows the direction in the preview and beside the agent cursor, then fades after input stops. Hover to reveal the icon controls. Drag the picture, enlarge it, or collapse it; close and reopen it with the conversation header’s preview button. Closing or collapsing stops preview captures while the agent continues working. Capture failures retain the last image with an unavailable notice. Preview images are display-only and do not add model input or Session events.

### Test from a conversation

Concurrent viewers share one in-flight capture per Session. A missing target uses `previewIdleIntervalMs` (2000 ms by default); existing and active targets use `previewIntervalMs` and `previewActiveIntervalMs`. Closing the last viewer cancels and joins its capture. Capture failures distinguish missing permissions, timeout, and oversized images while retaining the last image.

Follow the [computer-control guide](../../../docs/user/guide/computer-control.md) to test permissions, browser tabs, and native application input from a conversation. It explains the expected results and recovery.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

The [patch](cordis.patch.yml) inserts isolated browser-use and computer-use registries plus the configurable provider. The Host mounts the [unified runtime](../computer-use-unified/README.md) with a settings resolver. Each Agent captures one validated configuration when its resource is acquired; input mode is resolved again for each operation. The shared native queue serializes desktop calls. The browser half registers one bundle configuration slot using the existing settings form and dictionaries. It unloads with the plugin.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Unified computer runtime](../computer-use-unified/README.md) — operations, failures, and resource ownership.
- [Plugin Manager](../../boot/plugin-manager/README.md) — activation and profile persistence.
- [Computer-control guide](../../../docs/user/guide/computer-control.md) — manual tests.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [unified provider](../computer-use-unified/README.md), which owns the computer tool, guidance, and results.

#### KV Cache effect

The provider owns prefix changes when activation adds or removes its tool and guidance, and append-only result history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Browser and native application limits belong to the unified provider. Existing Chrome tabs and login state are not imported.
- Input mode, approval policy, and preview pacing apply immediately. Other saved runtime defaults apply to the next Agent that acquires resources.
- The detail form is available while the plugin is enabled. macOS permission grants remain an operating-system action.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context — click to expand</summary>

None.

</details>
