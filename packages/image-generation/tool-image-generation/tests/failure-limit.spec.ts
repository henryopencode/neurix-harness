/** Failed image calls stop production agent turns without another provider or model request. */

import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TOOL_ABORTED_BEFORE_DISPATCH } from '@deepseek-ai/dsh-tools'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as plugin from '../src/index.ts'

const IMAGE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
let ctx: Context
let server: Server
let root: string
let endpoint: string
let requests: unknown[]
let successfulCalls: Set<number>

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-image-failure-limit-'))
  ctx = new Context()
  requests = []
  successfulCalls = new Set()
  server = createServer((req, res) => {
    void (async () => {
      const parts: Buffer[] = []
      for await (const part of req) {
        const bytes: unknown = part
        if (!(bytes instanceof Uint8Array)) throw new Error('image fixture received a non-binary chunk')
        parts.push(Buffer.from(bytes))
      }
      requests.push(JSON.parse(Buffer.concat(parts).toString('utf8')))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(successfulCalls.has(requests.length)
        ? { base_resp: { status_code: 0 }, data: { image_base64: [IMAGE] } }
        : { base_resp: { status_code: 1008, status_msg: 'fixture provider failure' } }))
    })().catch((error: unknown) => { res.destroy(error instanceof Error ? error : new Error('image fixture failed', { cause: error })) })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('image fixture has no TCP address')
  endpoint = `http://127.0.0.1:${address.port}/v1/image_generation`
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LocalAttachmentStore, { dshHome: root })
})

afterEach(async () => {
  const failures: unknown[] = []
  await ctx.fiber.dispose().catch((error: unknown) => failures.push(error))
  await new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error === undefined) resolve(); else reject(error) })
    server.closeAllConnections()
  }).catch((error: unknown) => failures.push(error))
  await rm(root, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
  if (failures.length) throw new AggregateError(failures, 'image failure-limit teardown failed')
})

function mount(config: plugin.Options = {}) {
  return ctx.plugin(plugin, {
    enabled: true, provider: 'minimax', endpoint, apiKey: 'fixture-key', model: 'image-01', responseFormat: 'b64_json', ...config,
  }).await()
}

function imageCall(index: number, args: object = { prompt: `Image attempt ${index}` }) {
  return toolCallResponse(`image-${index}`, 'generate_image', args)
}

async function run(adapter: MockAdapter, id = 'image-limit-agent'): Promise<Agent> {
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Generate an image.' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  return agent
}

function results(agent: Agent) {
  return agent.session.snapshotEvents().filter(event => event.type === 'tool/result').map(event => event.data)
}

function endings(agent: Agent) {
  return agent.session.snapshotEvents().filter(event => event.type === 'turn/end').map(event => event.data.reason)
}

function expectStopped(agent: Agent, limit: number): void {
  const reason = endings(agent).at(-1)
  expect(reason).toMatchObject({ kind: 'aborted', reason: { kind: 'hook' } })
  if (reason?.kind !== 'aborted' || reason.reason.kind !== 'hook') throw new Error('image failure limit did not stop the turn')
  expect(reason.reason.reason).toContain(`failed ${limit} times`)
}

describe('image-generation failure limit', () => {
  it('preserves three native provider errors and stops before a fourth request despite changed arguments', async () => {
    await mount()
    const adapter = new MockAdapter([imageCall(1), imageCall(2), imageCall(3), imageCall(4), textResponse('DONE')])
    const agent = await run(adapter)
    expect(requests).toHaveLength(3)
    expect(adapter.requests).toHaveLength(3)
    expect(results(agent)).toHaveLength(3)
    expect(results(agent).every(result => result.message.isError && result.error?.code === 'IMAGE_GENERATION_PROVIDER_ERROR')).toBe(true)
    expect(endings(agent)).toHaveLength(1)
    expectStopped(agent, 3)
  })

  it('counts schema and MiniMax parameter failures before any provider request', async () => {
    await mount()
    const adapter = new MockAdapter([
      imageCall(1, {}), imageCall(2, { prompt: 'A square', count: 0 }), imageCall(3, { prompt: 'A square', size: 'invalid' }), imageCall(4),
    ])
    const agent = await run(adapter)
    expect(requests).toHaveLength(0)
    expect(adapter.requests).toHaveLength(3)
    expect(results(agent)).toHaveLength(3)
    expect(results(agent).every(result => result.message.isError)).toBe(true)
    expect(endings(agent)[0]).toMatchObject({ kind: 'aborted', reason: { kind: 'hook' } })
  })

  it('keeps successful images while counting all failures in the same turn', async () => {
    await mount()
    successfulCalls.add(2)
    const adapter = new MockAdapter([imageCall(1), imageCall(2), imageCall(3), imageCall(4), imageCall(5)])
    const agent = await run(adapter)
    expect(requests).toHaveLength(4)
    expect(adapter.requests).toHaveLength(4)
    expect(results(agent).map(result => result.message.isError)).toEqual([true, false, true, true])
    expect(results(agent)[1]?.message.content.some(block => block.type === 'image')).toBe(true)
    expect(endings(agent)[0]).toMatchObject({ kind: 'aborted', reason: { kind: 'hook' } })
  })

  it('dispatches only three calls from a batch of five and acknowledges the remaining calls as cancelled', async () => {
    await mount()
    const chunks: StreamChunk[] = Array.from({ length: 5 }, (_, index) => index).flatMap(index =>
      imageCall(index).filter(chunk => chunk.type !== 'usage' && chunk.type !== 'finish')
        .map(chunk => 'index' in chunk ? { ...chunk, index } : chunk),
    )
    chunks.push({ type: 'finish', reason: { kind: 'tool-calls' } })
    const adapter = new MockAdapter([chunks, imageCall(6)])
    const agent = await run(adapter)
    expect(requests).toHaveLength(3)
    expect(adapter.requests).toHaveLength(1)
    expect(results(agent)).toHaveLength(5)
    expect(results(agent).slice(0, 3).map(result => result.error?.code)).toEqual(Array(3).fill('IMAGE_GENERATION_PROVIDER_ERROR'))
    expect(results(agent).slice(3).map(result => result.error?.code)).toEqual(Array(2).fill(TOOL_ABORTED_BEFORE_DISPATCH))
    expect(endings(agent)[0]).toMatchObject({ kind: 'aborted', reason: { kind: 'hook' } })
  })

  it('preserves an already queued user message when the turn stops', async () => {
    await mount()
    ctx.on('tools/result', (exec) => {
      if (exec.callId !== 'image-2') return
      exec.agent?.followup(createUserMessage({ content: [{ type: 'text', text: 'Try again in a new turn.' }], source: { kind: 'user' } }))
    })
    const adapter = new MockAdapter(Array.from({ length: 7 }, (_, index) => imageCall(index + 1)))
    const agent = await run(adapter)
    expect(requests).toHaveLength(3)
    expect(adapter.requests).toHaveLength(3)
    expect(agent.inbox.nextTurn).toHaveLength(1)
    expect(agent.inbox.nextTurn[0]?.content).toEqual([{ type: 'text', text: 'Try again in a new turn.' }])
    expect(endings(agent)[0]).toMatchObject({ kind: 'aborted', reason: { kind: 'hook' } })
  })

  it('gives a new user turn its own three attempts after the previous turn stopped', async () => {
    await mount()
    const adapter = new MockAdapter(Array.from({ length: 7 }, (_, index) => imageCall(index + 1)))
    const agent = await run(adapter)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Try again in a new turn.' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(requests).toHaveLength(6)
    expect(adapter.requests).toHaveLength(6)
    expect(results(agent).map(result => result.turn)).toEqual([1, 1, 1, 2, 2, 2])
    expect(endings(agent)).toHaveLength(2)
    expect(endings(agent).every(reason => reason.kind === 'aborted' && reason.reason.kind === 'hook')).toBe(true)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'user')).toHaveLength(2)
  })

  it('keeps failure budgets independent for different agents', async () => {
    await mount()
    const adapter = new MockAdapter([imageCall(1), imageCall(2), textResponse('DONE'), imageCall(3), imageCall(4), imageCall(5), imageCall(6)])
    const first = await run(adapter, 'first-agent')
    const second = await ctx.agentLoop.create(SessionId('second-agent'), { provider: 'mock', model: 'mock' })
    second.followup(createUserMessage({ content: [{ type: 'text', text: 'Generate an image.' }], source: { kind: 'user' } }))
    await second.whenIdle()
    expect(results(first)).toHaveLength(2)
    expect(endings(first)[0]).toEqual({ kind: 'completed' })
    expect(results(second)).toHaveLength(3)
    expect(endings(second)[0]).toMatchObject({ kind: 'aborted', reason: { kind: 'hook' } })
    expect(requests).toHaveLength(5)
    expect(adapter.requests).toHaveLength(6)
  })

  it('honours a configured smaller failure cap', async () => {
    await mount({ maxErrorsPerTurn: 2 })
    const adapter = new MockAdapter([imageCall(1), imageCall(2), imageCall(3)])
    const agent = await run(adapter)
    expect(requests).toHaveLength(2)
    expect(adapter.requests).toHaveLength(2)
    expectStopped(agent, 2)
  })

  it('removes its cancellation listeners when the plugin is disposed', async () => {
    const fiber = await mount()
    ctx.on('agent/pre-step', async ({ step }, next) => {
      if (step === 2) await fiber.dispose()
      return next()
    })
    const adapter = new MockAdapter([imageCall(1), imageCall(2), imageCall(3), textResponse('DONE')])
    const agent = await run(adapter)
    expect(requests).toHaveLength(1)
    expect(adapter.requests).toHaveLength(4)
    expect(results(agent)).toHaveLength(3)
    expect(endings(agent)[0]).toEqual({ kind: 'completed' })
  })
})
