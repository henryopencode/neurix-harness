/** Deterministic external MCP service used by the management browser scenario. */
import { createInterface } from 'node:readline'
const input = createInterface({ input: process.stdin })
input.on('line', line => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  let result
  switch (message.method) {
    case 'initialize':
      result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'knowledge-fixture', version: '1.0.0' } }
      break
    case 'tools/list':
      result = { tools: [{ name: 'search_notes', description: 'Search knowledge notes.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }] }
      break
    case 'ping': result = {}; break
    default:
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }) + '\n')
      return
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n')
})
