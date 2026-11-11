---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-11-upstream-reconciliation

English | [中文](2026-11-11-upstream-reconciliation.zh.md)

## Summary

Joins the independent Neurix and upstream acknowledgement histories while retaining model-group input and adding upstream retry, caller attribution, settlement metadata, and incomplete skill-catalog metadata.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-11-upstream-reconciliation
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: ["2026-10-27-retry-control-input","2026-11-02-model-group-log"]
    after: "c01312dce265a26f033f25e012830cdc159b93a8c6074e05130f77e84855d2ec"
    decision: same-version
  - root: "event:developer/message"
    previous: ["2026-10-27-retry-control-input","2026-11-02-model-group-log"]
    after: "17c1b0ac5a36418912eb86c56f212cd97d32e7ffcd08f299b71837dc5701dc3f"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: ["2026-10-27-retry-control-input","2026-11-02-model-group-log"]
    after: "02651b56829e75445cb3d3581b196a2ccfbaf3c4e5366ca4824b7d30cfe5966a"
    decision: same-version
  - root: "event:user/message"
    previous: ["2026-10-27-retry-control-input","2026-11-02-model-group-log"]
    after: "e31ec829991312695ddb74564b6593c1229b6e6d72ade53e5d039ab09fb31a6b"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing event discriminators and Session format 4 remain unchanged. Each merged root is compared with both historical branch tips. The model-group notice source retains its recorded fields. Missing principal, stopReason, and incomplete fields retain their prior meanings. The caller union still accepts owner records and now includes share-viewer attribution. Older Neurix readers preserve these user/developer source JSON objects, including unknown retry kinds and caller metadata, without deriving live access authority from them; ordinary message content remains readable. Updated readers accept both historical source sets. New metadata does not reinterpret existing Team or model-group events. All historical acknowledgements and version-named Session generations are retained.

<a id="verification"></a>
## Verification

Persistence history and schema suites: 172 tests passed, including explicit joins, unjoined-branch rejection, independent-parent checks, retained predecessors, deletion tombstones, and immutable prior files. Current-format restoration: 3 tests passed. Session envelope, continuation, Remote access, LiveShare identity, legacy Team persistence, and model-group suites: 281 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
