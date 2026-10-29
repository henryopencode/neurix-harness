/** Real Loader, AgentLoop, tool pipeline, and durable screenshot composition. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { initProfile } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
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
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import * as Provider from '../src/index.ts'
import * as BrowserProvider from '@deepseek-ai/dsh-experimental-browser-control'
import { desktop, resetDesktop, screenshotBase64 } from '../../computer-use-unified/tests/fixtures/native.ts'
import { browserFixture, resetBrowser } from '../../computer-use-unified/tests/fixtures/browser.ts'

vi.mock('../../computer-use-unified/src/native-driver.ts', async () => import('../../computer-use-unified/tests/fixtures/native.ts'))
vi.mock('../../computer-use-unified/src/platform.ts', () => ({ nativeDesktopSupported: true }))
vi.mock('playwright', async () => ({ chromium: { launch: (await import('../../computer-use-unified/tests/fixtures/browser.ts')).launch } }))

class VisualModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text', 'image'] })
  }
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const index = this.requests.push(options) - 1
    const actions = [
      { tool: 'application', action: 'list' },
      { tool: 'browser', action: 'open_browser', url: 'https://fixture.test' },
      { tool: 'browser', action: 'type', target: 'tab-1', locator: { by: 'css', selector: '#task-name' }, replace: true, text: 'Harness control works' },
      { tool: 'application', action: 'observe', target: 'window-1', screenshot: true },
      { tool: 'browser', action: 'observe', target: 'tab-1', screenshot: true },
    ]
    const args = actions[index]
    if (args !== undefined) {
      const { tool, ...input } = args
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(`computer-${index}`), name: tool, arguments: JSON.stringify(input) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Desktop targets were discovered; browser input was delivered.' } }
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

it('loads both bundles from YAML, isolates their tools and previews, and unloads applications without closing the browser', async () => {
  resetDesktop()
  resetBrowser()
  root = await mkdtemp(join(tmpdir(), 'dsh-unified-composition-'))
  initProfile(root, [])
  const configPath = join(root, 'cordis.yml')
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-config-editor', ConfigEditor], ['@deepseek-ai/dsh-settings', Settings],
    ['@deepseek-ai/dsh-llm', LlmRuntime], ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry], ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime], ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-tool-executor-native', NativeToolExecutor],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop], ['@deepseek-ai/dsh-attachment-local', LocalAttachmentStore],
    ['@deepseek-ai/dsh-computer-use', ComputerUseRegistry], ['@deepseek-ai/dsh-browser-use', BrowserUseRegistry],
    ['@deepseek-ai/dsh-typert-registry', TypertRegistry],
    ['@deepseek-ai/dsh-experimental-computer-control', Provider],
    ['@deepseek-ai/dsh-experimental-browser-control', BrowserProvider],
  ])
  await writeFile(configPath, [...modules.keys()].flatMap(name => [
    `- name: '${name}'`,
    ...name === '@deepseek-ai/dsh-attachment-local' ? ['  config:', `    dshHome: ${JSON.stringify(root)}`] : [],
    ...name === '@deepseek-ai/dsh-experimental-browser-control' ? ['  config:', '    typingDelayMs: 0', '    cursorMoveDurationMs: 0'] : [],
    ...name === '@deepseek-ai/dsh-experimental-computer-control' ? ['  config:', '    screenshots: false', '    showOverlay: false', '    typingDelayMs: 0'] : [],
  ]).join('\n') + '\n')
  const context = ctx = new Context()
  context.provide('profileContext', {
    name: 'test', startedBundles: [], dir: root, patchPath: join(root, 'cordis.patch.yml'),
    installAnchor: join(root, 'package.json'), cwd: root, home: root, overlays: [], telemetryDisabledEnv: undefined,
  })
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
  const agent = await context.agentLoop.create(SessionId('computer-control-loader'), { provider: 'unified-fixture', model: 'vision' })
  const idle = Promise.withResolvers<undefined>()
  const stop = context.on('agent/status', ({ agent: subject, status }) => { if (subject === agent && status === 'idle') idle.resolve(undefined) })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Check desktop availability, then write Harness control works into the browser field and capture it.' }], source: { kind: 'user' } }))
  await idle.promise
  stop()
  const preview = context.get('computerPreview')
  if (preview === undefined) throw new Error('Computer preview contribution was not mounted')
  expect(await preview.frame(SessionId('missing-preview-owner'), new AbortController().signal)).toMatchObject({ frame: { kind: 'idle' } })
  expect((await preview.frame(agent.session.id, new AbortController().signal)).frame.kind).toBe('frame')
  expect(desktop.calls.some(call => call.name === 'list_windows')).toBe(true)
  expect(browserFixture.calls.filter(call => call.name === 'keyboard.insertText')
    .map(call => typeof call.args[0] === 'string' ? call.args[0] : '').join('')).toBe('Harness control works')
  expect(agent.session.deriveMessages().some(message => message.role === 'tool' && message.content.some(block =>
    block.type === 'text' && block.text.includes('"inputMode":"foreground"')))).toBe(true)
  expect(model.requests).toHaveLength(6)
  expect(JSON.stringify(model.requests[0])).toContain('Use application to observe and operate macOS applications')
  expect(JSON.stringify(model.requests[0])).toContain('Use browser for an isolated browser session')
  expect(JSON.stringify(model.requests[0])).not.toContain('select Foreground system input')
  expect(context.computerUse.providerName).toBe('unified')
  expect(context.browserUse.providerName).toBe('unified')
  const messages = agent.session.deriveMessages()
  const screenshot = messages.flatMap(message => message.content).find(block => block.type === 'image')
  if (screenshot?.type !== 'image') throw new Error('The screenshot was not durably admitted')
  expect(Buffer.from((await context.attachments.readImage(screenshot.attachment)).data).toString('base64')).toBe(screenshotBase64)
  expect(JSON.stringify(model.requests[5]?.messages)).toContain(JSON.stringify(screenshot.attachment))
  expect(JSON.stringify(messages)).not.toContain(screenshotBase64)
  expect(agent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(5)
  const browserPreview = context.get('browserPreview')
  if (browserPreview === undefined) throw new Error('Browser preview was not mounted')
  expect((await browserPreview.frame(agent.session.id, new AbortController().signal)).frame.kind).toBe('frame')
  expect(context.tools.schemas().map(tool => tool.name)).toEqual(expect.arrayContaining(['application', 'browser']))
  const provider = [...context.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-experimental-computer-control')
  if (provider?.fiber === undefined) throw new Error('The unified provider was not loaded')
  await provider.fiber.dispose()
  expect(context.get('computerPreview')).toBeUndefined()
  expect(context.tools.schemas().some(tool => tool.name === 'application')).toBe(false)
  expect(context.computerUse.providerName).toBeUndefined()
  expect(context.browserUse.providerName).toBe('unified')
  expect(context.tools.schemas().some(tool => tool.name === 'browser')).toBe(true)
  expect((await browserPreview.frame(agent.session.id, new AbortController().signal)).frame.kind).toBe('frame')
  const browserProvider = [...context.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-experimental-browser-control')
  await browserProvider?.fiber?.dispose()
  expect(browserFixture.calls.filter(call => call.name === 'browser.close')).toHaveLength(1)
  expect(context.get('browserPreview')).toBeUndefined()
  expect(context.browserUse.providerName).toBeUndefined()
  expect(context.tools.schemas().some(tool => tool.name === 'browser')).toBe(false)
  expect(desktop.shutdowns).toBe(1)
  expect(desktop.destroys).toBe(1)
  expect('default' in Provider).toBe(false)
})
