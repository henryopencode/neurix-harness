---
kind: upgrade-guide
description: "Browser startup failures report BROWSER_START_FAILED instead of a generic operation failure."
---

# Handle browser startup failures

English | [中文](guide.zh.md)

## Change

Computer control reports `BROWSER_START_FAILED` when the selected browser cannot launch. The result requests a user correction and instructs the agent to stop automatic recovery through other applications or installers. Host errors retain the launch failure as their cause; model-visible messages omit the launcher's installation commands.

## Migration

1. Handle `BROWSER_START_FAILED` alongside other computer-tool failures if your integration switches on error codes.
2. Install or unblock the selected browser, or choose an installed browser in Computer Control. Save the setting and start a new conversation before another browser attempt.
3. Check the next browser operation's returned state. Do not use unrelated desktop applications or terminal commands to recover automatically.
