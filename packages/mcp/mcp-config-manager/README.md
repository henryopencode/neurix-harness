---
description: "Inspect MCP connections and tools, edit server configuration, and recover failed configuration changes."
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-config-manager

English | [中文](README.zh.md)

## Summary

Manage global MCP server configuration and inspect supervised connection states and tools through authenticated Remote methods. Existing machine-wide connections appear without importing their configuration. Authentication values remain on the Host; an empty credential field preserves existing values.

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

Use the [MCP page](../../client/ui-mcp/README.md) in the Web or Desktop sidebar. Add a server with a command and one argument per line, or select Streamable HTTP and enter an endpoint. Environment variables and request headers accept a JSON object of strings; leave the field blank to preserve existing values, or enter `{}` to clear them. Changes apply to every profile on this machine. Removing a connection does not delete remote documents.

| Field | Default | Meaning |
|---|---|---|
| `refreshIntervalMs` | `1000` | Interval between connection snapshots while the page is open. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Working context for maintainers — click to expand</summary>

The page reads connection-owned state through the shared MCP registry and a generated Remote contribution. The Host reads the effective Loader rows and edits only MCP declarations or overrides in `$DSH_HOME/cordis.patch.yml`, preserving unrelated rows, comments, and JavaScript tags. A configuration revision rejects stale edits. File locking and HMR serialization prevent overlapping writes; failed reconciliation restores the old file and composition. A failed restoration disables further writes and requires checking configuration before restarting.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [MCP](../../../docs/subsystems/mcp.md)
- [MCP client](../mcp-client/README.md)
- [MCP resources](../mcp-resources/README.md)

-----

<a id="model-experience"></a>
## Model Experience

### MCP configuration

#### What the model sees

The manager registers no model-facing tools or prompt sections. Connected servers supply `mcp__<serverName>__<tool>` tools. Adding or disabling a server changes the tools and instructions supplied by that MCP client.

#### Token effect

Reading connection state adds no model input. The [MCP client](../mcp-client/README.md#model-experience) defines the token effect of server changes.

#### KV Cache effect

None for reading connection state. Server changes follow the MCP client's tool and system-prompt behavior.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The page manages global servers; agent-preset and nested Include declarations remain with their configuration owners.
- Expression-backed connections are visible but edited in the configuration file.
- Deployment-provided servers can be disabled or overridden; only servers declared in the global user patch can be removed.
- A successful save confirms configuration was applied; connection state separately reports whether the server is reachable.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
