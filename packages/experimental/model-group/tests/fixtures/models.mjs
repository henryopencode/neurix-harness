/** Keyless external-model adapter for real dsh profile composition tests. */
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'

function text(value) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: value },
    { type: 'block-end', index: 0, block: { type: 'text', text: value } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class Models extends LlmAdapter {
  async listModels(provider) {
    return ['leader', 'worker-b', 'worker-c'].map(id => ({ provider, id, name: id, inputModalities: ['text'] }))
  }
  async * stream(options) {
    const task = options.messages.find(message => message.source?.kind === 'user')
    const body = task?.content.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''
    if (body.includes('SNAPSHOT_MODEL_GROUP')) {
      const listed = options.messages.some(message => message.content.some(block => block.type === 'tool-call' && block.name === 'list_agents'))
      if (!listed) {
        const id = ToolCallId('snapshot-roster')
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id, name: 'list_agents', argumentsDelta: '{}' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'list_agents', arguments: '{}' } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      const result = options.messages.findLast(message => message.role === 'tool')
      const roster = JSON.parse(result.content.filter(block => block.type === 'text').map(block => block.text).join(''))
      if (!roster.some(member => member.target === 'lead' && member.model === options.model)) throw new Error('Roster did not report the selected leader model')
      yield * text('Configured model group is ready.'); return
    }
    if (options.model !== 'leader') { yield * text(`Result from ${options.model}`); return }
    const assigned = options.messages.some(message => message.content.some(block => block.type === 'tool-call' && block.name === 'model_group_assign'))
    if (!assigned) {
      for (const [index, model] of ['b', 'c'].entries()) {
        const id = ToolCallId(`group-${model}`)
        const args = JSON.stringify({ model, task: `Check ${model}`, ...model === 'b' ? { task_id: '' } : {} })
        yield { type: 'block-start', index, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index, id, name: 'model_group_assign', argumentsDelta: args }
        yield { type: 'block-end', index, block: { type: 'tool-call', id, name: 'model_group_assign', arguments: args } }
      }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const settled = options.messages.filter(message => message.source?.kind === 'subagent-settled')
    yield * text(settled.length >= 2 ? 'Group complete: worker-b and worker-c.' : 'Waiting for the assigned models.')
  }
}

/** Fixture identity. */
export const name = 'model-group-test-models'
/** LLM registry owner. */
export const inject = ['llm']
/** Register only the deterministic test route. */
export function apply(ctx, config = {}) { ctx.llm.registerAdapter([config.provider ?? 'model-group-test'], new Models()) }
