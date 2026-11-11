import { createHash } from 'node:crypto'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { nativeKnowledgeAvailable } from './native-platform.ts'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { LlmAdapter, createUserMessage, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { brandString } from '@deepseek-ai/dsh-brand'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { ownerPeer, peerFor } from '../../../api/gateway/tests/peer.ts'
import KnowledgeBase from '../src/index.ts'

const nativeIt = it.skipIf(!nativeKnowledgeAvailable)

const contexts: Context[] = []
const roots: string[] = []

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    /** An ungranted caller used to verify knowledge workspace authorization. */
    'knowledge-test-viewer': { readonly kind: 'knowledge-test-viewer' }
  }
}
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

class ScriptedModel extends LlmAdapter {
  private calls = 0
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const call = [
      { name: 'knowledge_import', arguments: JSON.stringify({ path: 'guide.md' }) },
      { name: 'knowledge_search', arguments: JSON.stringify({ query: '字幕' }) },
    ][this.calls++]
    if (call !== undefined) {
      const id = ToolCallId(`knowledge-${this.calls}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: call.name, argumentsDelta: call.arguments }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, ...call } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const text = '发布前检查字幕和封面。来源：guide.md，第 2 行。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'knowledge-composition-')))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  const harness = await mountAgentLoopTestHarness(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  Object.assign(ctx.loader.builtins, { include: Include, knowledge: KnowledgeBase })
  const config = join(root, 'cordis.yml')
  await writeFile(config, `- name: cordis:knowledge\n  config:\n    path: ${JSON.stringify(join(root, 'index'))}\n`)
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  const agent = await harness.create(SessionId('knowledge-caller'), { provider: 'scripted', model: 'fixture' }, { cwd: root })
  return { root, ctx, agent, harness }
}

nativeIt('loads through Cordis, logs real import/search results, and unregisters all tools on disposal', async () => {
  const { root, ctx, agent } = await fixture()
  await writeFile(join(root, 'guide.md'), '# 发布规范\n发布前检查字幕和封面。\n')
  ctx.llm.registerAdapter(['scripted'], new ScriptedModel())
  const idle = new Promise<void>((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: '导入 guide.md，并查询发布前需要检查什么。' }], source: { kind: 'user' } }))
  await idle
  const results = agent.session.snapshotEvents().filter(event => event.type === 'tool/result').map((event, index) => ({ ...event.data, message: { ...event.data.message, id: `{{message-${index + 1}}}` } }))
  expect(results).toHaveLength(2)
  const source = join(root, 'guide.md')
  const id = createHash('sha256').update(source).digest('hex')
  const normalized = JSON.stringify(results, null, 2).replaceAll(source, '{{source}}').replaceAll(id, '{{document-id}}') + '\n'
  await expect(normalized).toMatchFileSnapshot('./expected/tool-results.json')
  const entry = [...ctx.loader.entries()].find(entry => entry.options.name === 'cordis:knowledge')
  await entry?.fiber?.dispose()
  expect(ctx.tools.schemas().some(tool => tool.name.startsWith('knowledge_'))).toBe(false)
})

nativeIt('denies missing callers and cross-workspace reads through the native executor', async () => {
  const { root, ctx, agent, harness } = await fixture()
  const signal = new AbortController().signal
  const denied = await executeToolFixture(ctx, { name: 'knowledge_list', arguments: {}, callId: ToolCallId('missing-agent'), signal })
  expect(denied).toMatchObject({ isError: true, error: { info: { code: 'KNOWLEDGE_UNAUTHORIZED' } } })
  await writeFile(join(root, 'guide.md'), '工作区私有资料：字幕规范。')
  const imported = await executeToolFixture(ctx, { agent, name: 'knowledge_import', arguments: { path: 'guide.md' }, callId: ToolCallId('import'), signal })
  expect(imported.isError).toBe(false)
  const other = await harness.create(SessionId('other-workspace'), {}, { cwd: join(root, 'other') })
  const found = await executeToolFixture(ctx, { agent: other, name: 'knowledge_search', arguments: { query: '字幕' }, callId: ToolCallId('denied-search'), signal })
  expect(found.content).toEqual([{ type: 'text', text: '{"mode":"keyword","passages":[]}' }])
  const invalid = await executeToolFixture(ctx, { agent, name: 'knowledge_read', arguments: { document_id: 'invalid', chunk: 0, version: 'invalid' }, callId: ToolCallId('invalid-id'), signal })
  expect(invalid).toMatchObject({ isError: true, error: { info: { code: 'KNOWLEDGE_INVALID_INPUT' } } })
})

nativeIt('keeps the optional management controller registered and shares uploaded references with native tools', async () => {
  const { ctx, root, agent } = await fixture()
  const workspaceId = brandString<WorkspaceId>('knowledge-workspace')
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(RemoteAccessService)
  ctx.provide('workspaceRegistry', { get: (id: WorkspaceId) => id === workspaceId ? { path: root } : undefined })
  ctx.provide('workspaceController', {})
  await ctx.plugin(TypertGateway)
  expect(ctx.get('knowledgeController')).toBeDefined()
  const signal = new AbortController().signal
  const original = await ctx.knowledgeController.upload(workspaceId, 'guide.md', Buffer.from('字幕审核和封面检查。').toString('base64'), false, signal)
  const dashboard = await ctx.typertGateway.invoke({ namespace: 'knowledge', method: 'dashboard',
    args: { workspaceId, query: '', offset: 0 }, peer: ownerPeer(ctx) })
  expect(dashboard).toMatchObject({ documents: [original], totalDocuments: 1 })
  const found = await executeToolFixture(ctx, { agent, name: 'knowledge_search', arguments: { query: '字幕' }, callId: ToolCallId('uploaded-search'), signal })
  expect(JSON.stringify(found.content)).toContain('字幕审核和封面检查')
  await expect(ctx.knowledgeController.upload(workspaceId, 'guide.md', Buffer.from('新版字幕审核。').toString('base64'), false, signal))
    .rejects.toMatchObject({ code: 'knowledge/operation-failed', details: { reason: 'KNOWLEDGE_ALREADY_EXISTS' } })
  const updated = await ctx.knowledgeController.upload(workspaceId, 'guide.md', Buffer.from('新版字幕审核。').toString('base64'), true, signal)
  expect(updated.documentId).toBe(original.documentId)
  expect(updated.version).not.toBe(original.version)
  await expect(ctx.typertGateway.invoke({ namespace: 'knowledge', method: 'dashboard',
    args: { workspaceId, query: '', offset: 0 }, peer: peerFor(ctx, { kind: 'knowledge-test-viewer' }) }))
    .rejects.toMatchObject({ code: 'remote-access/denied' })
  for (const [filename, base64] of [['../guide.md', 'YQ=='], ['guide.md', 'YQ'], ['bad\u0000.md', 'YQ==']]) {
    await expect(ctx.knowledgeController.upload(workspaceId, filename!, base64!, false, signal))
      .rejects.toMatchObject({ code: 'knowledge/operation-failed', details: { reason: 'KNOWLEDGE_INVALID_INPUT' } })
  }
  await ctx.knowledgeController.deleteDocument(workspaceId, original.documentId, signal)
  expect((await ctx.knowledgeController.dashboard(workspaceId, '', 0, signal)).totalDocuments).toBe(0)
  const entry = [...ctx.loader.entries()].find(item => item.options.name === 'cordis:knowledge')
  await entry?.fiber?.dispose()
  expect(ctx.get('knowledgeController')).toBeUndefined()
})
