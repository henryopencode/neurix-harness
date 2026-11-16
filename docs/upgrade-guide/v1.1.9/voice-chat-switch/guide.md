---
kind: upgrade-guide
description: "Realtime voice conversations use an independent plugin switch instead of Voice input."
---

# Independent Voice chat switch

English | [中文](guide.zh.md)

## Change

Voice input controls dictation. Realtime voice conversations require the separate Voice chat bundle, `@deepseek-ai/dsh-voice-chat-bundle`. Enabling Voice input alone does not load Breeze or show its conversation control. Existing recognition and synthesis caches remain reusable.

## Migration

1. Update the application, open Plugins, and enable **Voice chat**.
2. Open **Voice chat** beside Send. Prepare missing resources, then choose **Start conversation**.
3. Keep **Voice input** enabled only if you also want dictation. Switching either feature off retains the other's recognition service while it is needed.
