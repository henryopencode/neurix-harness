---
description: "Composer Git branch display and local branch switching. Read for checkout safety, shared working-tree effects, and refresh behavior."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-git-branch

English | [中文](README.zh.md)

## Summary

See the working directory and current Git branch directly above the composer, search local branches, and switch without leaving the conversation. Blank Sessions use the same branch menu in their workspace row. Git retains its normal file-conflict and worktree-occupancy checks and refuses to overwrite ignored files. Every Session sharing the working tree sees the same checkout.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

The shipped Web bundle mounts this plugin. It requires the Session, Agent, subprocess, sandbox, locale, resource, slot, and generated Remote services; its Host and browser halves load together. A directory outside Git renders no control. Detached HEAD displays the abbreviated commit; an unborn repository displays its symbolic branch.

The menu marks the current branch and disables branches checked out by another worktree. Switching affects the working tree's files, so a menu notice names its effect on other Sessions. The Host rejects switching while a running Agent uses the same root or one of its subdirectories, and checks the displayed checkout before changing it. It never stashes, discards changes, creates branches, guesses remote branches, or runs checkout hooks. Git filters still run under the Session's sandbox policy. Git refusal keeps the current UI and reports a localized toast; cancellation or failed post-switch inspection requires checking the branch and working files because a checkout may have completed.

| Field | Default | Meaning |
|---|---|---|
| `timeoutMs` | `15000` | Deadline for one Git command |
| `maxOutputBytes` | `1048576` | Captured bytes per output stream; overflow fails |
| `graceMs` | `1000` | Termination grace period |
| `refreshIntervalMs` | `3000` | External Git observation interval |

-----

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host's `workspaceGit` Remote service resolves the caller's live Session and uses its working directory and sandbox policy. The browser's `git-branch` resource owns the observation stream, reconnects through the Remote supervisor, and releases it when its last holder leaves. A successful switch wakes observers of the same working-tree root. External changes appear on the next observation; read failures retain the last value and expose Retry. Operation toasts live in `shell.overlay`, so navigating away preserves the outcome report.

</details>

-----

## Further Exploration

- [Conversation](../../../docs/subsystems/conversation.md) — Session composition.
- [Client resources](../../../docs/subsystems/client-resources.md) — observation ownership.
- [Open in app](../ui-open-in-app/README.md) — neighbouring directory control.

-----

## Model Experience

None, as the package provides human Git controls without adding model input.

#### KV Cache effect

None; the plugin neither assembles nor sends model requests.

## Known Limitations and Deferred Work

- Only existing local branches are selectable. Fetching, remote branch creation, stashing, and merge resolution remain Git operations outside this control.
- The running check observes Harness Agents, including other Sessions; external programs and Agents starting after admission can still change files concurrently.
- Git must be installed in the composed subprocess provider's environment. A read failure exposes Retry rather than treating an unreadable repository as a non-repository.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Git inspection and switches share the composed subprocess execution world; local filesystem shortcuts would inspect the wrong repository for an SSH provider.

</details>
