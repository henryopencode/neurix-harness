/** Bash outcome metadata survives real tool execution and validated JSONL reopening. */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as BashEnv from '@deepseek-ai/dsh-shell-env'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { PtcRuntime, type PtcRunRequest, type PtcRunSpec, type PtcRunResult } from '@deepseek-ai/dsh-ptc-runtime'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/** Deterministic PTC host: the production executor owns nested tool dispatch. */
class BashBindingRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'fixture'
  resolve(request: PtcRunRequest): PtcRunSpec {
    return { ...request, cwd: process.cwd(), timeoutMs: 120_000 }
  }
  async run(spec: PtcRunSpec): Promise<PtcRunResult> {
    const bash = spec.bindings.find(binding => binding.global === 'tools')?.functions.bash
    if (bash === undefined) throw new Error('missing bash binding')
    return { logs: [], value: await bash({ command: 'printf durable; exit 7', description: 'Read execution outcome' }) }
  }
}

describe.each(['native', 'nested'] as const)('Bash durable outcome through %s execution', (mode) => {
  it('preserves metadata and model output after closing and reopening the JSONL log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-bash-outcome-'))
    const ctx = new Context()
    const reopened = new Context()
    onTestFinished(async () => {
      try { await ctx.fiber.dispose() } finally {
        try { await reopened.fiber.dispose() } finally { await rm(root, { recursive: true, force: true }) }
      }
    })
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true, tools: { mode: mode === 'nested' ? 'ptc' : 'native' } })
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    await ctx.plugin(AgentLoop, { agents: [] })
    if (mode === 'nested') await ctx.plugin(BashBindingRuntime)
    await ctx.plugin(Loader)
    Object.assign(ctx.loader.builtins, {
      include: Include,
      subprocess: LocalSubprocessRuntime,
      shellEnv: BashEnv,
      shell: LocalBashExecutor,
      bash: ToolBash,
    })
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- name: cordis:subprocess',
      '- name: cordis:shellEnv',
      '- name: cordis:shell',
      '  config:',
      '    timeoutMs: 10000',
      '- name: cordis:bash',
      '',
    ].join('\n'))
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    expect(ctx.tools.get('bash')).toBeDefined()
    const adapter = new MockAdapter([
      toolCallResponse('outcome', mode === 'native' ? 'bash' : 'run_code', mode === 'native'
        ? { command: 'printf durable; exit 7', description: 'Read execution outcome' }
        : { code: 'return await tools.bash({ command: "printf durable; exit 7", description: "Read execution outcome" })', description: 'Read nested execution outcome' }),
      textResponse('Observed execution.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const id = SessionId(`durable-bash-${mode}`)
    const handle = await ctx.agents.create({ sessionId: id, agentOptions: { provider: 'mock', model: 'mock' } })
    const captured: SessionEvent[] = []
    ctx.on('session/event', (session, event) => { if (session.id === id) captured.push(event) })
    const idle = new Promise<void>((resolve) => {
      const dispose = ctx.on('agent/status', ({ agent, status }) => {
        if (agent.id === id && status === 'idle') { dispose(); resolve() }
      })
    })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Run the command.' }], source: { kind: 'user' } }))
    await idle
    const event = captured.find(event => mode === 'native' ? event.type === 'tool/result' : event.type === 'tool/ptc-dispatch')
    if (event?.type !== 'tool/result' && event?.type !== 'tool/ptc-dispatch') throw new Error('missing shell result event')
    const expectedMeta = {
      cwd: process.cwd(),
      shellOutcome: { kind: 'foreground', exitCode: 7, signal: null, timedOut: false, aborted: false, timeoutMs: 10_000 },
    }
    expect(event.data.meta).toEqual(expectedMeta)
    const content = event.type === 'tool/result' ? event.data.message.content : event.data.content
    expect(content).toEqual([{ type: 'text', text: 'durable\n[exit code: 7]' }])
    if (event.type === 'tool/result') expect(event.data.message.isError).toBe(false)
    expect(adapter.requests).toHaveLength(2)
    await handle.dispose()
    await ctx.fiber.dispose()
    await reopened.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    const reader = await reopened.sessionPersistence.open(id, 'read')
    try {
      const stored = (await reader.read()).events.find(row => row.seq === event.seq)
      expect(stored).toEqual(event)
      expect(stored?.type === event.type ? stored.data.meta : undefined).toEqual(expectedMeta)
    } finally { await reader.close() }
  })
})
