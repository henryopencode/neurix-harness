# Browser and application control

English | [中文](computer-control.zh.md)

Two optional plugins separate independent web sessions from visible desktop input. Enable either or both from **Plugins → Extension tools**.

## Choose a plugin

| Plugin | Platforms | Operation | Preview |

|---|---|---|---|

| Browser control | Windows, macOS, Linux | Independent hidden Playwright browser; separate tabs and sign-ins | Current page viewport |

| Application control | macOS | Native foreground mouse and keyboard input, including browser application windows | Exact application window |

Browser session isolation is not an operating-system security sandbox. Application control acts on the user’s shared desktop and can operate existing signed-in browser windows through native controls.

## Configure and approve

For Browser control, select an installed Chrome, Chromium, or Edge distribution. Its windows always stay hidden. Application control requires macOS Accessibility permission for the app that launches Harness; native screenshots and preview also require Screen & System Audio Recording.

Each plugin has its own **Ask before each action** switch. After saving, it applies immediately to all conversations. `list` and `observe` remain automatic; every other action needs separate one-shot approval. Missing approval support blocks the action. Approval for one plugin does not authorize the other.

Keep **Include screenshots** off for text models and enable it for an image-capable model. Picture-in-picture remains available independently. Other saved settings apply in a new conversation. Advanced settings contain only the relevant timeouts.

## Test browser control

In a new conversation, ask: “Use browser to open Example Domain, report its title, create a second tab, and close only the second tab.” Inspect the process details for `browser` calls. The first tab should remain available. No regular browser window should move or receive input.

Subsequent browser actions use returned tab ids and observed locators. The tool returns fresh state after input; verify the intended text or page change. Failed or canceled input may have partly applied, so observe before continuing.

## Test application control

Create a blank TextEdit document, then ask: “Use application to find this blank TextEdit window, enter Harness control works, and read it back without saving or closing the document.” Confirm that the actual document contains the text, the system pointer moves to the target, and the application preview shows it.

The application tool discovers exact native windows with `list` and `observe`. Native clicks use fresh `element_token` values as `ref`; pixel input needs a fresh screenshot of the same window. Existing browser applications use these native operations too. Playwright tab actions are unavailable in this tool.

Application actions activate the selected window and use the system mouse and keyboard. Avoid interacting with the desktop during input. **Stop generating** cancels subsequent input while retaining already delivered changes.

## Watch picture-in-picture

Each enabled source automatically shows its own preview when a target is available. Browser control shows the complete current viewport, 1440×900 CSS pixels by default. The Agent scrolls for content beyond that viewport. Resizing the preview scales the image without changing page layout. Application control shows the selected native window.

Drag the image to move it anywhere inside the application window. Drag either bottom corner, or focus a corner and use arrow keys, to resize while preserving its proportions. Hover or focus the image for Maximize, Restore, and Collapse. Maximize fills the available window; Restore returns to the previous floating size and position. Collapse pauses capture while the Agent continues; use Expand to resume. Double-click the image to toggle maximization, or press Escape while the preview is focused to restore it.

A capture failure retains the previous image with a retry action. Preview frames are display-only and do not add model input or Session events.

## Recover and finish

Missing targets require another `list` and `observe`. Page dialogs require an explicit `dialog` accept or dismiss action. A browser startup failure stops browser work; install or select a supported browser yourself and start a new conversation. The Agent must not use another application or an installer to bypass that failure.

Slow loading and failed screenshots keep owned tabs open. Reuse the returned target and observe with `screenshot: false`; report repeated failures. `browser.reset` closes only that Session’s browser. `application.reset` releases references and leaves user applications open. A resumed Session rediscovers its targets.

See [Browser control](../../../packages/experimental/browser-control/README.md), [Application control](../../../packages/experimental/computer-control/README.md), and the [standalone unified provider](../../../packages/experimental/computer-use-unified/README.md) for configuration and limits.
