---
description: "Inspect MCP connections and tools, edit server configuration, and recover failed configuration changes."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mcp

English | [中文](README.zh.md)

## Summary

Inspect global MCP connections and tools from the sidebar, and add, edit, disable, reconnect, or remove servers. Existing machine-wide connections appear without importing their configuration. Authentication values remain on the Host; an empty credential field preserves existing values.

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

Open **MCP** in the Web or Desktop sidebar. Click the tool count row to expand or collapse the server's tools; the row highlights on hover and shows keyboard focus. Add a server with a command and one argument per line, or select Streamable HTTP and enter an endpoint. Environment variables and request headers accept a JSON object of strings; leave the field blank to preserve existing values, or enter `{}` to clear them. Changes apply to every profile on this machine. Removing a connection does not delete remote documents.

The [MCP server manager](../../mcp/mcp-manager/README.md) owns connection polling and configuration persistence.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Working context for maintainers — click to expand</summary>

The page reads connection-owned state through a client resource and generated Remote methods. The [MCP server manager](../../mcp/mcp-manager/README.md) owns file edits, optimistic revisions, reload serialization, and recovery; the page keeps authentication values out of responses and reports completed operations through a shell-owned notice.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [MCP](../../../docs/subsystems/mcp.md)
- [MCP client](../../mcp/mcp-client/README.md)
- [MCP resources](../../mcp/mcp-resources/README.md)

-----

<a id="model-experience"></a>
## Model Experience

### MCP configuration

#### What the model sees

This page registers no model-facing tools or prompt sections. Connected servers supply `mcp__<serverName>__<tool>` tools. Adding or disabling a server changes the tools and instructions supplied by that MCP client.

#### Token effect

Viewing this page adds no model input. The [MCP client](../../mcp/mcp-client/README.md#model-experience) defines the token effect of server changes.

#### KV Cache effect

None for viewing or editing the page. Server changes follow the MCP client's tool and system-prompt behavior.

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
