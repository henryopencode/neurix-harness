/** Provider rollback, direct-call admission, failure reporting, and quiescent unload. */

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ComputerUseRegistry from '@deepseek-ai/dsh-computer-use'
import BrowserUseRegistry from '@deepseek-ai/dsh-browser-use'
import { BrowserUseProviderName } from '@deepseek-ai/dsh-browser-use/brand'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import * as Provider from '../src/index.ts'
import { desktop, resetDesktop } from './fixtures/native.ts'

vi.mock('../src/native-driver.ts', async () => import('./fixtures/native.ts'))
vi.mock('../src/platform.ts', () => ({ nativeDesktopSupported: true }))
let ctx: Context
beforeEach(async () => {
  resetDesktop()
  ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(ComputerUseRegistry)
  await ctx.plugin(BrowserUseRegistry)
})
afterEach(async () => { desktop.call = undefined; await ctx.fiber.dispose() })

it('fails closed without an approver and leaves discovery automatic', async () => {
  await ctx.plugin(Provider, { requireInputApproval: true, showOverlay: false, screenshots: false })
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('computer-approval-unavailable'))
  // Tool admission does not grant computer authorization.
  ctx.on('tools/pre-execute', async () => ({ kind: 'allow' }), { prepend: true })
  const execute = (args: Record<string, unknown>) => ctx.tools.execute({ agent, name: 'computer', arguments: args,
    callId: ToolCallId('approval-required'), signal: new AbortController().signal })
  expect((await execute({ action: 'list' })).isError).toBe(false)
  expect((await execute({ action: 'observe', target: 'window-1', screenshot: false })).isError).toBe(false)
  const denied = await execute({ action: 'type', target: 'window-1', ref: 'field-1', text: 'forbidden' })
  expect(denied.isError).toBe(true)
  expect(JSON.stringify(denied.content)).toContain('APPROVAL_UNAVAILABLE')
  expect(desktop.value).toBe('')
  expect(desktop.calls.some(call => call.name === 'type_text')).toBe(false)
})

it('logs a separate one-shot approval for each action and honors rejection', async () => {
  await ctx.plugin(ApprovalService)
  await ctx.plugin(Provider, { requireInputApproval: true, showOverlay: false, screenshots: false })
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('computer-approval-decisions'))
  agent.session.append('turn/start', { turn: 1 })
  let allowed = false
  ctx.on('approval/request', async () => allowed ? 'allowed-once' : 'rejected')
  const execute = () => ctx.tools.execute({ agent, name: 'computer', arguments: { action: 'reset' },
    callId: ToolCallId('approval-decision'), signal: new AbortController().signal })
  expect((await execute()).isError).toBe(true)
  allowed = true
  expect((await execute()).isError).toBe(false)
  expect(agent.session.snapshotEvents().filter(event => event.type === 'approval/decided').map(event => event.data.outcome))
    .toEqual(['rejected', 'allowed-once'])
  agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
})

it('defers native initialization until use and reports its failure without unloading browser tools', async () => {
  desktop.createError = new Error('Native initialization failed')
  const provider = ctx.plugin(Provider, {})
  await provider
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('unified-native-unavailable'))
  const result = await ctx.tools.execute({ agent, name: 'computer', arguments: { action: 'list' }, callId: ToolCallId('init-failed'), signal: new AbortController().signal })
  expect(JSON.stringify(result.content)).toContain('Native initialization failed')
  expect(ctx.computerUse.providerName).toBe('unified')
  expect(ctx.tools.schemas().some(tool => tool.name === 'computer')).toBe(true)
  await provider.dispose()
  expect(ctx.computerUse.providerName).toBeUndefined()
  expect(ctx.browserUse.providerName).toBeUndefined()
})

it('reads the current user input mode for an existing live Agent', async () => {
  const settings = Provider.Config({ inputMode: 'background', showOverlay: false, screenshots: false })
  await Provider.mountComputerControl(ctx, () => settings)
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('unified-live-input-mode'))
  ctx.on('tools/pre-execute', async () => ({ kind: 'allow' }), { prepend: true })
  const execute = (args: Record<string, unknown>) => ctx.tools.execute({ agent, name: 'computer', arguments: args,
    callId: ToolCallId('live-input-mode'), signal: new AbortController().signal })
  await execute({ action: 'list' })
  settings.inputMode = 'foreground'
  const observed = await execute({ action: 'observe', target: 'window-1' })
  expect(observed.content.find(block => block.type === 'text')?.text).toContain('"inputMode":"foreground"')
  settings.inputMode = 'background'
  const back = await execute({ action: 'observe', target: 'window-1' })
  expect(back.content.find(block => block.type === 'text')?.text).toContain('"inputMode":"background"')
})

it('rolls back the first reservation when another browser provider already owns the second', async () => {
  const release = ctx.browserUse.register(BrowserUseProviderName('other'))
  await expect(ctx.plugin(Provider, {})).rejects.toThrow('already registered')
  expect(ctx.computerUse.providerName).toBeUndefined()
  expect(ctx.browserUse.providerName).toBe('other')
  await release()
})

it('rejects computer calls outside an exact live Agent even through direct tool execution', async () => {
  await ctx.plugin(Provider, {})
  const result = await ctx.tools.execute({ name: 'computer', arguments: { action: 'list' }, callId: ToolCallId('no-agent'), signal: new AbortController().signal })
  expect(result.isError).toBe(true)
  expect(JSON.stringify(result.content)).toContain('exact live Agent')
  expect(desktop.calls).toEqual([])
})

it('advertises action and operation arguments as explicit object properties in the model schema', async () => {
  await ctx.plugin(Provider, {})
  const parameters = ctx.tools.schemas().find(tool => tool.name === 'computer')?.parameters
  expect(parameters).toMatchObject({
    type: 'object', required: ['action'],
    properties: {
      action: { type: 'string', enum: ['list', 'open_app', 'open_browser', 'new_tab', 'observe', 'navigate', 'move', 'click', 'type', 'key', 'scroll', 'drag', 'menu', 'dialog', 'close_tab', 'reset'] },
      target: { type: 'string' }, url: { type: 'string' }, text: { type: 'string' },
      bundleId: { type: 'string' },
      locator: { type: 'object', required: ['by'], properties: { by: { enum: ['role', 'label', 'text', 'css'] } } },
    },
  })
  expect(parameters).not.toHaveProperty('oneOf')
  expect(parameters).not.toHaveProperty('anyOf')
  expect(parameters).toHaveProperty('properties.bundleId.description', 'Required for open_app: macOS bundle identifier, for example com.apple.TextEdit. Use {"action":"open_app","bundleId":"com.apple.TextEdit"}.')
})

it('rejects missing action-specific arguments before any native input is dispatched', async () => {
  await ctx.plugin(Provider, { showOverlay: false, screenshots: false })
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('unified-invalid-action-arguments'))
  for (const args of [{}, { action: 'type', target: 'window-1' }, { action: 'click' }]) {
    const result = await ctx.tools.execute({ agent, name: 'computer', arguments: args, callId: ToolCallId('invalid-fields'), signal: new AbortController().signal })
    expect(result.isError).toBe(true)
  }
  expect(desktop.calls).toEqual([])
})

it('explains a missing application identifier as a structured failure without acquiring desktop resources', async () => {
  await ctx.plugin(Provider, {})
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('unified-missing-bundle-id'))
  const result = await ctx.tools.execute({ agent, name: 'computer', arguments: { action: 'open_app' }, callId: ToolCallId('missing-bundle-id'), signal: new AbortController().signal })
  expect(result.isError).toBe(true)
  const text = result.content.find(block => block.type === 'text')
  expect(text?.text).toContain('"code":"INVALID_ARGUMENTS"')
  expect(text?.text).toContain('"effect":"none"')
  expect(text?.text).toContain('bundleId')
  expect(text?.text).toContain('com.apple.TextEdit')
  expect(desktop.calls).toEqual([])
})

it('recovers a missing target by retaining the native ref without dispatching the invalid click', async () => {
  await ctx.plugin(Provider, { inputMode: 'background', showOverlay: false, screenshots: false })
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('unified-missing-ref-target'))
  const execute = (args: Record<string, unknown>) => ctx.tools.execute({ agent, name: 'computer', arguments: args,
    callId: ToolCallId('ref-target'), signal: new AbortController().signal })
  await execute({ action: 'list' })
  await execute({ action: 'observe', target: 'window-1' })
  const missing = await execute({ action: 'click', ref: 'field-1' })
  expect(missing.isError).toBe(true)
  const failure = missing.content.find(block => block.type === 'text')?.text
  expect(failure).toContain('"code":"INVALID_ARGUMENTS"')
  expect(failure).toContain('"effect":"none"')
  expect(failure).toContain('keep ref')
  expect(failure).not.toContain('open_app')
  expect(desktop.calls.some(call => call.name === 'click')).toBe(false)
  expect((await execute({ action: 'click', target: 'window-1', ref: 'field-1' })).isError).toBe(false)
  expect(desktop.calls.filter(call => call.name === 'click')).toHaveLength(1)
})

it('reports declared and unexpected operation failures and keeps unrelated tools delegated', async () => {
  await ctx.plugin(Provider, { showOverlay: false, screenshots: false })
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('unified-failures'))
  const execute = (args: Record<string, unknown>) => ctx.tools.execute({ agent, name: 'computer', arguments: args, callId: ToolCallId('failure'), signal: new AbortController().signal })
  expect(JSON.stringify((await execute({ action: 'observe', target: 'unknown' })).content)).toContain('TARGET_NOT_FOUND')
  desktop.call = () => Promise.reject(new Error('Native connection failed'))
  expect(JSON.stringify((await execute({ action: 'list' })).content)).toContain('OPERATION_FAILED')
  // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- native callbacks can reject with non-Error values.
  desktop.call = () => Promise.reject('external failure')
  expect(JSON.stringify((await execute({ action: 'list' })).content)).toContain('external failure')
  desktop.call = undefined
  ctx.tools.register({
    name: 'echo', description: 'Echo a fixture value.', parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'echo' }] },
    execute: () => Promise.resolve('echo'),
  })
  const other = await ctx.tools.execute({ agent, name: 'echo', arguments: {}, callId: ToolCallId('echo'), signal: new AbortController().signal })
  expect(other.isError).toBe(false)
})

it('unload aborts a pending native call and awaits it before destroying the SDK', async () => {
  const provider = ctx.plugin(Provider, { showOverlay: false, screenshots: false })
  await provider
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('unified-unload'))
  const entered = Promise.withResolvers<undefined>()
  desktop.call = (name, _args, signal) => {
    if (name !== 'check_permissions') return Promise.resolve({ content: [{ type: 'text', text: name }] })
    return new Promise((_resolve, reject) => {
      entered.resolve(undefined)
      signal?.addEventListener('abort', () => { reject(new Error('Native call interrupted')) }, { once: true })
    })
  }
  const operation = ctx.tools.execute({ agent, name: 'computer', arguments: { action: 'list' }, callId: ToolCallId('pending'), signal: new AbortController().signal })
  await entered.promise
  await provider.dispose()
  expect((await operation).isError).toBe(true)
  expect(desktop.shutdowns).toBe(1)
  expect(ctx.computerUse.providerName).toBeUndefined()
  expect(ctx.browserUse.providerName).toBeUndefined()
})
