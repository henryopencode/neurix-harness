---
description: "Show the current Git branch beside the conversation header’s project-opening control."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-git-branch

English | [中文](README.zh.md)

## Summary

See the current Session directory’s Git branch in the conversation header, immediately before the project-opening control. The badge follows branch changes and linked worktrees, identifies detached HEAD by its short commit, and stays absent outside a repository or when Git is unavailable. It reads repository metadata without changing files, the index, or the checkout.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The Web bundle includes this plugin. Click or focus the badge to read a long branch name in full. A read failure replaces the branch with a localized retry control; successful retries restore the current metadata.

| Configuration | Default | Meaning |
|---|---|---|
| `timeoutMs` | `5000` | Deadline for one Git observation |
| `refreshMs` | `5000` | Delay between observations while the header is subscribed |

<a id="understand-the-implementation"></a>
## Understand the implementation

The Host owns the `gitBranch.follow` Remote stream. The existing workspace-file Session lookup authorizes the caller and resolves the directory without activating an Agent. Git executes through the composed subprocess provider with bounded output and cancellation. The Client registers a `git-branch` resource and reads it through `useResource`; releasing the header stops its subscription. The badge occupies the existing conversation utility slot and uses locale-owned text and shared icons. See the [Web client reference](../../../docs/subsystems/web-client.md) for slot and resource ownership.

<a id="model-experience"></a>
## Model Experience

None, as branch metadata is presentation-only and is not added to model requests or Session events.

#### KV Cache effect

None; this plugin does not assemble or send model requests.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Branch changes appear on the next observation, rather than synchronously with an external Git command.
- The badge identifies the current branch; it does not switch branches or display uncommitted change counts.

<a id="dev-note"></a>
## Dev Note

None.
