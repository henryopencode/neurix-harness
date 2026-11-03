/** Client-safe connection state; excludes transport configuration and credentials. @module */
/** Connection-owned state and registered tools, without server credentials. */
export interface McpConnectionSnapshot {
  readonly state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  readonly tools: readonly { readonly name: string; readonly description: string }[]
}
