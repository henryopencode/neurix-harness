---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-25-native-subagent-activity

English | [中文](2026-11-25-native-subagent-activity.zh.md)

## Summary

Record native subagent activity in the parent Session for live and reopened Chat.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-25-native-subagent-activity
baseline: false
changes:
  - root: "event:subagent/activity"
    previous: null
    after: "c655b31b2fa0ea1fae76e3b256eb2f83b1e74e51c32ad8f0010010cfe8f732ea"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Each record is log-only and carries ignorable: true. Older readers retain the unknown record without applying it to model history or recovery. New readers open earlier logs without a native activity card when the record is absent. The existing catalog entry and completion notice continue to carry the child identity and result to their consumers.

<a id="verification"></a>
## Verification

The canonical event envelope suite covers preservation of opaque ignorable records. The external activation suite checks that the new records carry that marker and keep derived messages unchanged. The official Claude Code Web snapshot exercises live tool activity and settlement with a local model fixture.

<a id="dev-note"></a>
## Dev Note

None.
