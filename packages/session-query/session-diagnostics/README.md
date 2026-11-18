---
description: "Inspect local Session failures, configure bounded historical indexing, and review redacted diagnostic reports before downloading a local ZIP."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-diagnostics

English | [中文](README.zh.md)

## Summary

Inspect grouped Session failures in **Settings → Diagnostics** without changing the original logs. Filter by project, category, time, or text; expand a group to inspect occurrences and open its source Session. Normal listing uses the available index; an explicit refresh reads a bounded batch of historical Sessions. Preview selected groups or the current filtered results before downloading a local ZIP. Reports contain bounded, best-effort-redacted excerpts, not complete conversations, and require manual privacy review before sharing.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use the diagnostics settings page to inspect recorded failures, not to collect application crashes or verify recovery.

### Inspect and export

1. Open **Settings → Diagnostics**. The selected conversation's working directory is the default scope; without a selected conversation the page shows all authorized projects. Choose another project or all projects, then apply category, time, and text filters.
2. Check the coverage notice. **Refresh index** explicitly indexes historical Sessions; changing filters or reloading the list does not open cold logs. Counts show unindexed Sessions, omitted occurrences, and failed reads when results are incomplete. An empty result means no matching failures in the available index, not that every operation succeeded.
3. Expand a group to read bounded details and event/turn references. **Open source Session** opens the conversation, not a particular event. Where a recorded failed tool card offers a diagnostics shortcut, it opens this same settings section for that Session and expands the matching event when indexed; it does not trigger a cold refresh. Synthetic interrupted placeholders do not offer this action. Cause and recovery remain unverified.
4. Select groups, export one expanded group, or export all current filtered groups. Review the complete JSON preview, then choose **Download local ZIP**. The browser archives the frozen preview as `diagnostics.md` and `diagnostics.json`; confirmation does not fetch additional logs or upload the report.

The preview uses the same redacted records as the page. Diagnostic fields remain literal text in the Markdown report, including embedded Markdown, HTML, and code fences. Reports omit raw argument fields, full conversations, attachments, and successful command output. Common credential assignments, authentication headers, token patterns, URL query values, and home directory names are masked, but arbitrary error text can still contain private data. Review the complete preview before sharing; automatic masking is not comprehensive PII removal.

### Composition and configuration

The Web application composition includes this plugin. A custom composition mounts `@deepseek-ai/dsh-session-diagnostics` with the Session store, query service, projection registry/cache, and remote-access service; its browser entry requires the settings shell, generated Remote methods, locale, resources, and workspace navigation. The [Web application patch](../../bundle/web-app/cordis.patch.yml) owns the shipped wiring.

All limits are validated integers. Invalid values reject plugin configuration.

| Field | Default | Accepted range | Meaning |
|---|---|---|---|
| `maxOccurrencesPerSession` | `500` | `1`–`10000` | Retain the newest occurrences and bound pending tool-call references per Session |
| `maxDetailChars` | `2048` | `256`–`16384` | Maximum retained characters per detail excerpt, including a truncation marker |
| `maxOccurrencesPerQuery` | `1000` | `1`–`10000` | Maximum returned occurrences across groups; retain the newest matches |
| `maxSessionsPerRefresh` | `100` | `1`–`1000` | Maximum historical Sessions read by one explicit refresh |

Refresh prioritizes missing cached values, then newer Sessions. Project or source-Session scope limits the Sessions considered; text, category, and time filters limit returned records, not historical indexing work. Read failures leave visible partial results instead of treating unread history as empty. Group counts describe retained matches; omission counts can also include records outside the current filters.

### Failure categories

Classification uses structured event facts, not message-text guesses. Groups share category, source, code, and redacted summary.

| Category | Recorded facts |
|---|---|
| Arguments | Tool failures with `INVALID_ARGS` |
| Command | Foreground shell nonzero exits, signals, timeouts, or sandbox-runner failures |
| Permission | Foreground shell metadata reports a sandbox denial |
| Tool | Other error tool results, including validation failures without a specific structured code |
| Turn | A turn ends with an error reason |

Expected tool aborts, caller-aborted shell results, and shell results stopped by the user are excluded. Nonzero shell exits remain ordinary tool results; structured shell metadata makes them visible here even without `isError`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

A deterministic registered `diagnostics` projection derives redacted occurrences from committed tool results, nested PTC dispatches, and error turn endings. Its wire value uses `summary: false`, so general Session summaries do not carry the ledger. Inherited fork prefixes are excluded to avoid counting the same failures again. Original Session events remain authoritative; inspection and export append no presentation events.

`list` reads live projection snapshots or historical cached snapshots only. A missing value contributes to the unindexed count without an implicit cold read. `refresh` explicitly reads authorized historical logs and drives the registered cache fold. Both operations filter each Session through remote-access permissions, including a recheck after an awaited historical read.

Retention and excerpt limits participate in checkpoint validation. Retained memory scales with the occurrence cap multiplied by the text cap, plus bounded pending call references. A recorded failure copies at most the retained occurrence array; tool-call bookkeeping copies at most the bounded pending references. Unrelated events do not scan transcript text.

| Source | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | Validated limits, authorized cache-only listing, and explicit refresh |
| [`src/projection.ts`](src/projection.ts) | Deterministic retention, replay, and inherited-prefix exclusion |
| [`src/classify.ts`](src/classify.ts) | Structured failure classification shared by the index and optional tool-card shortcut |
| [`src/redact.ts`](src/redact.ts) | Bounded best-effort masking before excerpts enter the index |
| [`src/client/report.ts`](src/client/report.ts) | Frozen preview strings and browser-local ZIP generation |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read the adjacent owners for query, cache, and shell execution semantics.

- [Session query](../session-query/README.md) — live and durable history access.
- [Session projection](../../session/session-projection/README.md) — registered replay and lifecycle ownership.
- [Session projection cache](../../session/session-projection-cache/README.md) — historical projection checkpoints.
- [Bash tool](../../shell/tool-bash/README.md) — structured foreground execution facts and background acknowledgements.

-----

<a id="model-experience"></a>
## Model Experience

### Diagnostics inspection

#### What the model sees

Nothing directly. This package registers no tool, prompt section, or model-visible message; the `diagnostics` projection and report remain user-facing derived data.

#### Token effect

Zero added model-input or result tokens from listing, refreshing, inspecting, or exporting diagnostics.

#### KV Cache effect

None. Diagnostics do not change model requests or their reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

Index coverage describes the supported recorded facts, not a complete account of all failures. LiveShare viewers cannot list these local diagnostics or trigger historical indexing; both operations are owner-only.

- Historical Bash results without structured `shellOutcome` metadata cannot reliably supply command outcomes. The index does not reconstruct them from rendered exit markers; background acknowledgements and promoted commands also have no terminal outcome to classify.
- Refresh limits the number of Sessions, not the size of each selected log. Retention and response caps omit older occurrences, and truncated excerpts cannot recover the omitted text.
- The page does not collect general runtime crashes, edit triage state, diagnose root causes, or infer recovery from later similar calls. Source navigation opens the Session without an exact-event jump.
- Redaction is best-effort. Error excerpts and Session/event references can remain sensitive even when common credentials and home directory names are masked.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
