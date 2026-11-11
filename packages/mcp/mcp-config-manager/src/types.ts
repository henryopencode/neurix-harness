/** Client-safe MCP management requests and snapshots. @module */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { McpConnectionSnapshot } from '@deepseek-ai/dsh-mcp-resources/types'

/** Stable Loader identity of a configured MCP server. */
export type McpServerId = Branded<'McpServerId'>

/** Editable connection fields; omitted credentials retain existing values. */
export interface McpServerDraft {
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http'
  readonly command: string
  readonly args: string[]
  readonly cwd: string
  readonly url: string
  readonly credentials?: Record<string, string>
}

/** One global server, with credentials excluded from every response. */
export interface McpServerView {
  readonly id: McpServerId
  readonly serverName: string
  readonly enabled: boolean
  readonly removable: boolean
  readonly editable: boolean
  readonly connection: McpConnectionSnapshot | null
  readonly draft: McpServerDraft
}

/** Configuration revision and current connections for this Host. */
export interface McpManagerSnapshot {
  readonly revision: string
  readonly servers: McpServerView[]
  readonly writable: boolean
  readonly recoveryRequired: boolean
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'mcp/invalid-document': Record<string, never>
    'mcp/expression': Record<string, never>
    'mcp/invalid-config': Record<string, never>
    'mcp/duplicate': Record<string, never>
    'mcp/inherited': Record<string, never>
    'mcp/disabled': Record<string, never>
    'mcp/not-found': Record<string, never>
    'mcp/unavailable': Record<string, never>
    'mcp/read-only': Record<string, never>
    'mcp/conflict': Record<string, never>
    'mcp/overridden': Record<string, never>
    'mcp/recovery-required': Record<string, never>
    'mcp/reload-failed': Record<string, never>
  }
}
