---
kind: upgrade-guide
description: "Computer Control requires observed browser elements and applies a separate screenshot age limit to coordinate input."
---

# Computer Control requires current observed elements

English | [中文](guide.zh.md)

## Change

Browser locators must resolve to one actual DOM node included in the latest `fields` or `geometry.elements`. Replaced nodes, navigation, and changed implicit editor focus require another observation. Coordinate input uses `coordinateMaxAgeMs`, which defaults to 30000 ms, in addition to `observationMaxAgeMs`. Windows and Linux expose browser-only capabilities and refuse native application operations before input.

Native desktop initialization occurs on first use. Plugin activation does not check native runtime availability; startup failures are reported by the affected desktop call.

Native observations expose concise controls within the complete `maxSnapshotChars` result-text budget. Duplicated `tree_markdown`, driver diagnostics, and per-element screen `frame` are omitted. Expired native refs renew only when complete observations uniquely identify the unchanged visible control; otherwise input fails before dispatch.

## Migration

1. Copy returned locators and observe again after a navigation, replaced element, changed editor focus, `ELEMENT_NOT_OBSERVED`, or `SCREENSHOT_EXPIRED`. Use an explicit locator when switching editors.
2. Set `coordinateMaxAgeMs` in the unified provider's YAML `config` only when a deployment requires a different screenshot age. Keep coordinate input inside the returned screenshot dimensions.
3. Check `capabilities.native` in a `computer` result. Use browser targets when it is `false`. Native desktop operations require macOS.
4. For controls absent from `fields` and `geometry.elements`, use screenshot coordinates with an image-capable model or ask the user to handle them.
5. Use `list` to check desktop permissions and native startup before sending input. Keep browser-only workflows headless or disable native feedback when desktop access is unavailable.
6. Read native `state.elements` and `screenshot_frame` for controls and screenshot coordinates. Handle `elements_complete: false` and `omitted_elements`; increase `maxSnapshotChars` when required controls are omitted or metadata exceeds the budget. Observe again after `OBSERVATION_CHANGED`.
