---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-03-team-model-assignment

English | [中文](2026-11-03-team-model-assignment.zh.md)

## Summary

Adds Team model candidates, human stop controls, and role-attributed public replies to the existing Team log.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-03-team-model-assignment
baseline: false
changes:
  - root: "event:team/control"
    previous: null
    after: "e7dc7e291279ecac2c2291e82d8004312c7c6e165f69ace8331d18c3ec976c41"
    decision: same-version
  - root: "event:team/models"
    previous: null
    after: "3c856d90656eea4b2a37a1314ef2269fa86f130091f469e99512d13f2bf6ebe7"
    decision: same-version
  - root: "event:team/post"
    previous: null
    after: "3c15bfec435853b32326afc8bacdcabf531edb07bdf857f946c54dd2b7d296c2"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing Team and model-group records retain their event fields and remain readable. New team/models, team/control, and team/post discriminators are required-on-read; an older reader refuses unknown non-ignorable events instead of interpreting the Team state incorrectly. The current reader accepts earlier logs without these events and captures model defaults through new records. The Session header version remains unchanged.

<a id="verification"></a>
## Verification

111 Team domain, tool, and Client tests passed. The installed Team bundle assigned reviewer and researcher responsibilities to different model routes. The authored Team routing fixture was generated through the shipped headless profile.

<a id="dev-note"></a>
## Dev Note

None.
