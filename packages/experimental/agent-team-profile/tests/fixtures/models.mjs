/** Deterministic model routing through the real Team tools. */
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'

function text(value) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: value },
    { type: 'block-end', index: 0, block: { type: 'text', text: value } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}
class Models extends LlmAdapter {
  constructor(config) { super(); this.config = config }
  async listModels(provider) {
    return ['deepseek-v4-flash', 'review-model', 'research-model'].map(id => ({ provider, id, name: id, inputModalities: ['text'] }))
  }
  async *stream(options) {
    if (options.model !== 'deepseek-v4-flash') {
      if (this.config.hang) {
        const signal = options.signal
        if (signal === undefined) throw new Error('Team fixture needs cancellation')
        await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }) })
        return
      }
      yield *text(options.model === 'review-model' ? 'Review complete.' : 'Research complete.')
      return
    }
    const spawned = options.messages.some(message => message.content.some(block => block.type === 'tool-call' && block.name === 'spawn_teammate'))
    if (!spawned) {
      for (const [index, role] of ['reviewer', 'researcher'].entries()) {
        const id = ToolCallId('team-model-' + role)
        const args = JSON.stringify({ name: role, description: role === 'reviewer' ? 'Architecture review' : 'Evidence research', prompt: 'Complete the ' + role + ' responsibility', model: role === 'reviewer' ? 'review' : 'research' })
        yield { type: 'block-start', index, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index, id, name: 'spawn_teammate', argumentsDelta: args }
        yield { type: 'block-end', index, block: { type: 'tool-call', id, name: 'spawn_teammate', arguments: args } }
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const settled = options.messages.filter(message => message.source?.kind === 'subagent-settled')
    yield *text(settled.length >= 2 ? 'Team complete: reviewer and researcher used different models.' : 'The Team is working on its responsibilities.')
  }
}
export const name = 'team-models-fixture'
export const inject = ['llm']
export function apply(ctx, config = {}) { ctx.llm.registerAdapter([config.provider ?? 'team-test'], new Models(config)) }
