# Computer control

English | [中文](computer-control.zh.md)

Control browser tabs and macOS applications from a Harness Session with the opt-in unified provider. The same `computer` tool observes targets, performs input, and returns current state.

## Prerequisites

Use a macOS source checkout with the repository’s supported Node version, installed workspace dependencies, and Chrome. Configure a model route as usual. A model that declares image input can receive screenshots; text models can use browser accessibility state and native elements with `screenshot: false`.

Windows and Linux can use browser targets; native application control requires macOS. Check `capabilities.native` in the returned result before choosing a native operation. Enable **Ask before each computer action** to request a separate approval for each action except listing and observation; the switch takes effect immediately in all conversations.

Grant Accessibility to the application that launches Harness in System Settings → Privacy & Security. Native screenshots also require Screen & System Audio Recording for that application. Browser screenshots use Playwright and do not need this native recording grant. The provider does not change OS permissions.

## Enable from Plugins

Open **Plugins → Extension tools → Computer Control**, turn on its switch, and open the card. Enable **Show agent cursor and key indicators** to watch actions. Select your installed browser, leave browser windows visible, and keep screenshots off for an initial text-model test. Save changes and start a new conversation for runtime defaults. Input mode and approval changes apply to the next operation in existing conversations.

In a new conversation, first ask for permission and window inspection without input. Next run the browser test: it opens Example Domain, reads the title and heading, creates a second tab, and closes only that second tab. For the native test, first select **Foreground system input** and save, then create a blank TextEdit document and run the instructions to enter and read back the test text without saving a file. Expand the conversation’s process details to inspect `computer` calls and their results.

Browser success means both tabs are reported and the first remains open. Native success means the document contains the requested text and the returned state reports it. Model quota or balance errors occur before these operations; fix the account in Settings → Models and send the test again.

### Watch picture-in-picture

After the agent selects a target, the conversation shows **Computer picture-in-picture** in the upper-right corner. It displays the actual target window or page, its cursor, and the current action. Hover over the picture to reveal its icon controls. Drag the picture to move it; use the controls to enlarge, restore, collapse, or close it. Reopen it with the preview button in the conversation header. Closing or collapsing stops captures while the agent continues. A capture failure keeps the previous image with an unavailable notice. Native preview capture needs Screen & System Audio Recording even when screenshots are disabled for the model. Preview frames are not sent to the model or saved in the Session.

## Start a Session

From the repository root, select the optional patch with the normal `dsh` launcher:

```sh
pnpm dsh headless --patch apps/cli/config/examples/computer-use-unified.patch.yml "Use computer to list available targets and report whether desktop control is available in this mode. Do not send input."
```

Replace the task text with your intended workflow. For the Web UI, select `web` with the same patch after completing the normal Web build. Use this provider instead of another browser-use or computer-use provider. It is absent from default profiles.

The provider opens a separate browser profile and retains its tabs across calls. It does not read your current Chrome tabs or browser login state. Each live Session owns its own browser. Native windows remain shared with the desktop user.

## Complete a browser task

Ask the agent to open a page, fill a field, submit it, and check the visible result. The following tool calls show the targeting sequence; replace the URL and accessible names with the page you intend to operate.

```json
{"action":"open_browser","url":"https://example.com","screenshot":false}
```

Read the returned target id and accessibility tree. Subsequent input uses that target and an exact observed locator:

The locator must resolve to an element included in the latest `fields` or `geometry.elements`. Observe again after navigation or a replaced element. Address a different editor explicitly when focus changes. Coordinate input requires a screenshot no older than 30 seconds by default; `SCREENSHOT_EXPIRED` requires another screenshot.

```json
{"action":"type","target":"tab-1","locator":{"by":"role","role":"textbox","name":"Task name"},"text":"Computer control","replace":true,"screenshot":false}
```

A successful action returns a new observation. Check that observation for the intended value or visible success message. A click being delivered does not establish that a save or submission completed. `new_tab` opens another owned tab; `close_tab` closes only the selected owned tab.

## Operate a macOS application

Select **Foreground system input** in Computer Control and save before desktop discovery. For the CLI example patch, set `inputMode: foreground` under `computer-use-unified.config`. Use `list` to discover windows and permissions, then `observe` the selected window. Use the returned `element_token` as `ref` for clicks and typing. A new observation replaces old refs. Use `open_app` with an exact bundle id to launch the selected application.

```json
{"action":"open_app","bundleId":"com.apple.TextEdit"}
{"action":"observe","target":"window-1","screenshot":false}
```

Native testing requires the actual application window. Use the process and target returned by `open_app`, then confirm its editable field and button in `observe` before sending input. If the test application has exited, start it by its exact bundle id. Stop when that application or the required controls cannot be found.

Use the target returned by `open_app` in place of `window-1`. Application launch uses the plugin’s **Startup and navigation timeout**, which defaults to 30 seconds. If no window is ready or launch times out, call `list` to inspect the application before another attempt.

**Browser background only** is the default in Computer Control. It does not discover or operate desktop applications. Select **Foreground system input**, save, and list targets again to operate a macOS application. Foreground actions activate the exact target and use the system mouse and keyboard, so avoid using the desktop while one runs. `NATIVE_FOREGROUND_REQUIRED` means no desktop operation was dispatched. Browser JavaScript dialogs keep independent background feedback. **Stop generating** cancels further input; delivered input remains. Coordinate actions require a fresh screenshot of the exact target. `inputMode` reports the requested setting, not a measurement of window focus.

## Recover and finish

A missing or stale target requires `list` and `observe` again. A page dialog requires an explicit `dialog` action with `accept: true` or `accept: false`. Failed or canceled input may already have changed the application; inspect current state before another attempt. Slow loading and failed screenshots keep the browser open. If a result reports `browserStatus: open`, use its existing target and retry observation with `screenshot: false`; repeated failure requires reporting the limitation instead of resetting or reopening. Canceling foreground input retains the window; canceling page-scoped input can close the owned browser and invalidate its tabs.

Use `reset` to close the Session’s owned browser and release native references. User applications stay open. A resumed Session must discover targets again. The [package reference](../../../packages/experimental/computer-use-unified/README.md) defines configuration, failure fields, and remaining limits.
