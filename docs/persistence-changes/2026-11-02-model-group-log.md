---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-02-model-group-log

English | [中文](2026-11-02-model-group-log.zh.md)

## Summary

Adds model-group configuration, stop state, delivery ownership, public posts, direct-message acceptance receipts, receipt-only legacy input, and an optional immutable Team coordination owner.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-02-model-group-log
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-22-action-card-status"
    after: "5adf5419528ba88fd43c03e797037f9ea09073e1148bb1129ffecd38ff9395cb"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-22-action-card-status"
    after: "da068e2fdadd939ed9c43a7d518bbf67074490b621125d8b152d71c410e92025"
    decision: same-version
  - root: "event:model-group/configured"
    previous: null
    after: "a1059de515e04c62bb88dc809061ec527151f716a0a8a362f7f0fcf1b9f02179"
    decision: same-version
  - root: "event:model-group/delivery"
    previous: null
    after: "740ee628a101f94612c5b68114532352dd7b94366ca88e6cf675082cdc6e7dd4"
    decision: same-version
  - root: "event:model-group/dispatched"
    previous: null
    after: "87665aacf72a280474251fa2bb61e3027ecd6a66dc4dace062e7d1a40db771d7"
    decision: same-version
  - root: "event:model-group/member-stopped"
    previous: null
    after: "40301c3c85a0938a68b951415d4faeae615cd25150a7385999e9f49bc45188b4"
    decision: same-version
  - root: "event:model-group/post"
    previous: null
    after: "229ccf61e83412d3eeb162769fbb1cf558e9b0b5a2bda2b2f49f3b9f5801992b"
    decision: same-version
  - root: "event:model-group/stopped"
    previous: null
    after: "9c896e42bbc5434f132da30be1926f3ae8d9511edd06c9eed533ae8a6229c99b"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-22-action-card-status"
    after: "9d0736325d6f9d106c38bc2db06733a33dfc8e9f08a0358f42239acb234b4452"
    decision: same-version
  - root: "event:team/member"
    previous: "2026-09-11-initial"
    after: "2b793290774a8944713568c64f36a8f0d6844ed1f5608051a071241ab613fd21"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-22-action-card-status"
    after: "5ebf9f67d71fe74532e57bfa9483c25221538d4bafae324981d97df29c049cfb"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid and omitted coordination owners remain unassigned. The model-group/dispatched discriminator links public input sequences to acceptance receipts without asserting execution completion. Older readers refuse this unknown required tag rather than interpreting it as a reply. Current readers preserve the legacy notice source and existing model-group events; no existing tag gains another interpretation. Group orchestration starts no synthetic leader turn for new direct messages. The optional publicMessage marker identifies canonical user/message input; absent markers keep the existing public-post interpretation. Ordinary human records preserve title/activity discovery and remain reconstructable in later leader requests.

<a id="verification"></a>
## Verification

Focused runtime, Loader composition, Team roster, Chat projection, input-trigger, reference, and model-group UI tests cover current model selection, inactive-member model omission, direct delivery without a leader turn, receipt persistence, and distinct addressing and history-reference labels. The model-group recorded-session scenario exercises list_agents after an explicit route change.

<a id="dev-note"></a>
## Dev Note

None.
