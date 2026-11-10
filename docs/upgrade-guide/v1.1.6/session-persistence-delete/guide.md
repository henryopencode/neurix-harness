---
kind: upgrade-guide
description: Custom Session persistence backends must implement permanent deletion and await derived-record cleanup.
---

# Permanent Session deletion in custom backends

English | [中文](guide.zh.md)

## Change

`SessionPersistence` requires `delete(id): Promise<boolean>`. Custom backends must implement this method to support permanent deletion of archived Sessions. The shipped JSONL backend implements it. Existing Session formats and project files are unchanged.

## Migration

1. Implement `SessionPersistence.delete` in your backend. Refuse an active write owner before removing data, remove every stored generation for the requested id, and return whether the id existed.
2. After storage removal, await `ctx.serial('session-persistence/deleted', id)` to clear derived records. Dispatch it for absent ids too, so callers can retry incomplete cleanup. Propagate storage and cleanup failures.
3. Verify that an active writer prevents deletion, deletion survives reopening the backend, and retrying a missing id completes derived cleanup.
