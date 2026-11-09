---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-08-task-plan-metadata

English | [中文](2026-11-08-task-plan-metadata.zh.md)

## Summary

Adds optional task identities, phases, prerequisites, completion criteria, execution references, results, artifact paths, and owning turn to todo snapshots.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-08-task-plan-metadata
baseline: false
changes:
  - root: "event:todo/write"
    previous: "2026-09-11-initial"
    after: "2c187606e08fc85ad13f116151386ed787863cca3e66258a3c41e79a868d130e"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The todo/write discriminator and the required content/status fields retain their existing meanings and three status values. Current readers accept historical records without planning metadata or turn. Earlier readers can ignore the additional descriptive fields without interpreting pending work as completed; prerequisites remain declarative and do not introduce scheduling obligations. The private todos checkpoint version advances so incompatible cache state is rebuilt from the unchanged durable event family.

<a id="verification"></a>
## Verification

Focused todo and workflow tests pass, including rejection without append, whole-list metadata persistence, current and legacy checkpoint recovery, full replay, historical prepend, and live append. Shipped headless replay refresh exercises the new workflow-canvas scenario and existing todo-write consumers.

<a id="dev-note"></a>
## Dev Note

None.
