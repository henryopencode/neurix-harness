/** Real Loader, AgentLoop, tool pipeline, and durable screenshot composition. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import BrowserUseRegistry from '@deepseek-ai/dsh-browser-use'
import ComputerUseRegistry from '@deepseek-ai/dsh-computer-use'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import LlmRuntime, { LlmAdapter, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import * as Provider from '../src/index.ts'
import { desktop, resetDesktop, screenshotBase64 } from './fixtures/native.ts'

vi.mock('../src/native-driver.ts', async () => import('./fixtures/native.ts'))
vi.mock('../src/platform.ts', () => ({ nativeDesktopSupported: true }))

class VisualModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text', 'image'] })
  }
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const index = this.requests.push(options) - 1
    const actions = [
      { action: 'list' },
      { action: 'observe', target: 'window-1', screenshot: true },
      { action: 'click', target: 'window-1', ref: 'field-1' },
      { action: 'type', target: 'window-1', ref: 'field-2', text: 'Harness control works' },
      { action: 'click', target: 'window-1', ref: 'contact' },
      { action: 'key', target: 'window-1', keys: ['Return'] },
    ]
    const args = actions[index]
    if (args !== undefined) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(`computer-${index}`), name: 'computer', arguments: JSON.stringify(args) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Verified the field contains Harness control works.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

let ctx: Context | undefined
let root: string | undefined
afterEach(async () => {
  desktop.call = undefined
  await ctx?.fiber.dispose()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  ctx = undefined
  root = undefined
})

it('loads from YAML, changes the external field, admits a screenshot, and releases both providers', async () => {
  resetDesktop()
  desktop.extraElements = [{ element_token: 'contact', role: 'AXMenuItem', label: 'Contact',
    frame: { x: 128, y: 140, w: 250, h: 50 } }]
  desktop.call = async name => name === 'click' ? { content: [], structuredContent: {
    effect: 'unverifiable', route: 'accessibility', delivery: { mode: 'background' }, summary: 'AXPress delivered.',
  } } : undefined
  root = await mkdtemp(join(tmpdir(), 'dsh-unified-composition-'))
  const configPath = join(root, 'cordis.yml')
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime], ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry], ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime], ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-tool-executor-native', NativeToolExecutor],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop], ['@deepseek-ai/dsh-attachment-local', LocalAttachmentStore],
    ['@deepseek-ai/dsh-computer-use', ComputerUseRegistry], ['@deepseek-ai/dsh-browser-use', BrowserUseRegistry],
    ['@deepseek-ai/dsh-experimental-computer-use-unified', Provider],
  ])
  await writeFile(configPath, [...modules.keys()].flatMap(name => [
    `- name: '${name}'`,
    ...name === '@deepseek-ai/dsh-attachment-local' ? ['  config:', `    dshHome: ${JSON.stringify(root)}`] : [],
    ...name === '@deepseek-ai/dsh-experimental-computer-use-unified' ? ['  config:', '    inputMode: background', '    showOverlay: false', '    screenshots: false'] : [],
  ]).join('\n') + '\n')
  const context = ctx = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const internal = context.loader.internal
  if (internal === undefined) throw new Error('The Loader composition requires Node loader internals')
  context.loader.internal = { ...internal, async import(specifier: string) {
    if (!modules.has(specifier)) throw new Error(`Unexpected fixture module: ${specifier}`)
    return modules.get(specifier)
  } }
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()
  for (const entry of context.loader.entries()) await entry.fiber?.await()
  const model = new VisualModel()
  context.llm.registerAdapter(['unified-fixture'], model)
  const agent = await context.agentLoop.create(SessionId('unified-loader'), { provider: 'unified-fixture', model: 'vision' })
  const idle = Promise.withResolvers<undefined>()
  const stop = context.on('agent/status', ({ agent: subject, status }) => { if (subject === agent && status === 'idle') idle.resolve(undefined) })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Write Harness control works into the fixture field, then verify it.' }], source: { kind: 'user' } }))
  await idle.promise
  stop()
  expect(desktop.value).toBe('Harness control works')
  expect(model.requests).toHaveLength(7)
  expect(JSON.stringify(model.requests[3]?.messages)).toContain('unverifiable')
  expect(JSON.stringify(model.requests[3]?.messages)).toContain('stop repeating input')
  expect(JSON.stringify(model.requests[5]?.messages)).toContain('BACKGROUND_EFFECT_UNCONFIRMED')
  expect(JSON.stringify(model.requests[6]?.messages)).toContain('Further input to this window is blocked')
  expect(desktop.calls.some(call => call.name === 'hotkey')).toBe(false)
  expect(JSON.stringify(model.requests[0])).toContain('Use computer for browser tabs and macOS windows.')
  expect(context.computerUse.providerName).toBe('unified')
  expect(context.browserUse.providerName).toBe('unified')
  const messages = agent.session.deriveMessages()
  const screenshot = messages.flatMap(message => message.content).find(block => block.type === 'image')
  if (screenshot?.type !== 'image') throw new Error('The screenshot was not durably admitted')
  expect(Buffer.from((await context.attachments.readImage(screenshot.attachment)).data).toString('base64')).toBe(screenshotBase64)
  expect(JSON.stringify(model.requests[2]?.messages)).toContain(JSON.stringify(screenshot.attachment))
  expect(JSON.stringify(messages)).not.toContain(screenshotBase64)
  expect(agent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(6)
  const provider = [...context.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-experimental-computer-use-unified')
  if (provider?.fiber === undefined) throw new Error('The unified provider was not loaded')
  await provider.fiber.dispose()
  expect(context.tools.schemas().some(tool => tool.name === 'computer')).toBe(false)
  expect(context.computerUse.providerName).toBeUndefined()
  expect(context.browserUse.providerName).toBeUndefined()
  expect(desktop.shutdowns).toBe(1)
  expect(desktop.destroys).toBe(1)
  expect('default' in Provider).toBe(false)
})
