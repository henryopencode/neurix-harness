/** Real AgentLoop, Team, persistence, and model-group orchestration regressions. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import Commands from '@deepseek-ai/dsh-commands'
import { SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import Teams from '@deepseek-ai/dsh-experimental-agent-team'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { teamProjectionDefinition } from '../../agent-team/src/projection.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { TestSessionQuery } from '../../agent-team/tests/test-session-query.ts'
import ModelGroups, { type Config } from '../../model-group-runtime/src/index.ts'
import { modelGroupProjection } from '../../model-group-runtime/src/projection.ts'
import type { ModelGroupMember } from '../../model-group-runtime/src/types.ts'

const contexts: Context[] = []
const directories: string[] = []
const members: ModelGroupMember[] = ['a', 'b', 'c'].map(name => ({ name, label: `Model ${name}`, provider: 'mock', model: name, strengths: `tasks for ${name}` }))
const signal = new AbortController().signal

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function setup(script: ConstructorParameters<typeof MockAdapter>[0], maxParallel = 3) {
  const ctx = new Context(); contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  const root = await mkdtemp(join(tmpdir(), 'model-group-')); directories.push(root)
  await ctx.plugin(Persistence, { root })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(Commands)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Subagents)
  await ctx.plugin(Spawn, { providerName: 'spawn' })
  await ctx.plugin(Teams)
  const fiber = await ctx.plugin(ModelGroups, { members, leader: 'a', maxParallel })
  const adapter = new MockAdapter(script); ctx.llm.registerAdapter(['mock'], adapter)
  const lead = await ctx.agentLoop.create(SessionId('group'), { provider: 'mock', model: 'a' })
  const config = fiber.effectiveConfig as Config
  return { ctx, lead, adapter, fiber, config }
}

describe('model-group conversations', () => {
  it('refreshes unused groups on a live config save and freezes routes after a direct message', async () => {
    const { ctx, lead, fiber, adapter, config } = await setup(['hang'])
    const updated = members.map(member => member.name === 'b'
      ? { ...member, name: 'opus', model: 'opus', label: 'Claude Opus 5.5', strengths: 'Architecture and review' } : member)
    updateVolatile(config.members, createVolatile(updated))
    fiber.ctx.emit('loader/volatile-update', [['members']])
    expect(ctx.modelGroups.snapshot(lead)?.members).toEqual(updated)
    await ctx.commands.execute(lead, '/model-group tell opus Check the updated route', [], signal)
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    expect(adapter.requests.map(request => request.model)).toEqual(['opus'])
    expect(ctx.agents.turnBoundaryOf(lead.session).lastTurn).toBe(0)
    updateVolatile(config.members, createVolatile(members))
    fiber.ctx.emit('loader/volatile-update', [['members']])
    expect(ctx.modelGroups.snapshot(lead)?.members).toEqual(updated)
    await ctx.modelGroups.stop(lead)
  })

  it('preserves a started group when the configured leader and members change', async () => {
    const { ctx, lead, fiber, adapter, config } = await setup(['hang'])
    lead.steer(createUserMessage({ content: [{ type: 'text', text: 'Start this group' }], source: { kind: 'user' } }))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    updateVolatile(config.leader, createVolatile('c'))
    updateVolatile(config.members, createVolatile(members.filter(member => member.name === 'c')))
    fiber.ctx.emit('loader/volatile-update', [['leader'], ['members']])
    expect(ctx.modelGroups.snapshot(lead)?.leader).toBe('a')
    expect(ctx.modelGroups.snapshot(lead)?.members).toEqual(members)
    expect(lead.model.current()?.model).toBe('a')
    await ctx.modelGroups.stop(lead)
  })

  it('rejects self-assignment through the executor without publishing a reply or creating a task', async () => {
    const { ctx, lead, adapter } = await setup([
      toolCallResponse('assign-self', 'model_group_assign', { model: 'a', task: 'My independent opinion' }),
      textResponse('I will answer my part directly.'),
    ])
    lead.steer(createUserMessage({ content: [{ type: 'text', text: 'All models should give their independent opinion.' }], source: { kind: 'user' } }))
    await lead.whenIdle()
    const events = lead.session.snapshotEvents()
    const failure = events.find(event => event.type === 'tool/result' && event.data.message.isError)
    expect(failure?.type === 'tool/result' ? failure.data.error : undefined).toMatchObject({ code: 'GROUP_SELF_ASSIGNMENT' })
    expect(events.filter(event => event.type === 'model-group/post')).toEqual([])
    expect(ctx.agentTeams.listTasks(lead)).toEqual([])
    expect(ctx.agentTeams.listMembers(lead).filter(member => member.role !== 'lead')).toEqual([])
    expect(JSON.stringify(adapter.requests[0]?.messages)).toContain('You are a (Model a), the leader')
    await expect(ctx.modelGroups.assign(lead, 'a', [{ type: 'text', text: 'Self assignment' }], false, signal))
      .rejects.toMatchObject({ code: 'GROUP_SELF_ASSIGNMENT' })
  })

  it('publishes worker replies without posting the private assignment as leader speech', async () => {
    const { ctx, lead } = await setup([textResponse('Worker opinion')])
    await ctx.modelGroups.assign(lead, 'b', [{ type: 'text', text: 'Give an opinion using these internal instructions.' }], true, signal)
    await ctx.subagents.waitForChildren(lead)
    await lead.whenIdle()
    await vi.waitFor(() => { expect(ctx.agentTeams.listTasks(lead)[0]?.status).toBe('completed') })
    const posts = lead.session.snapshotEvents().filter(event => event.type === 'model-group/post')
    expect(posts).toHaveLength(1)
    expect(posts[0]?.type === 'model-group/post' ? posts[0].data : undefined)
      .toMatchObject({ member: 'b', text: 'Worker opinion' })
    expect(posts[0]?.type === 'model-group/post' ? typeof posts[0].data.sourceSeq : undefined).toBe('number')
  })

  it('defaults new conversations to multi while mode changes remain conversation-local', async () => {
    const { ctx, lead } = await setup([])
    expect(ctx.modelGroups.snapshot(lead)?.mode).toBe('multi')
    await ctx.modelGroups.setMode(lead, 'single')
    const next = await ctx.agentLoop.create(SessionId('next'), { provider: 'mock', model: 'a' })
    expect(ctx.modelGroups.snapshot(lead)?.mode).toBe('single')
    expect(ctx.modelGroups.snapshot(next)?.mode).toBe('multi')
    const tools = await ctx.tools.resolve({ agent: lead, modelSelection: { provider: 'mock', model: 'a' }, signal })
    try { expect(tools.view(lead).has('model_group_assign')).toBe(false); expect(tools.view(lead).has('model_group_tasks')).toBe(false) }
    finally { tools.dispose() }
    let restored = modelGroupProjection.init()
    for (const event of lead.session.snapshotEvents()) restored = modelGroupProjection.apply(restored, event)
    expect(restored.group).toEqual(ctx.modelGroups.snapshot(lead))
  })

  it('treats an ordinary conversation fork as its own group leader', async () => {
    const { ctx, lead } = await setup([])
    const seed = lead.session.snapshotEvents()
    const handle = await ctx.agents.create({
      sessionId: SessionId('group-fork'), seed, inheritedEventCount: SessionLogOffset(seed.length),
      meta: { isSeeded: true, parentSession: lead.id }, agentOptions: { provider: 'mock', model: 'a' },
    })
    const fork = handle.agent
    expect(fork.session.header.origin).toBeUndefined()
    expect(ctx.modelGroups.snapshot(fork)?.mode).toBe('multi')
    await ctx.modelGroups.setMode(fork, 'single')
    expect(ctx.modelGroups.snapshot(fork)?.mode).toBe('single')
    expect(ctx.modelGroups.snapshot(lead)?.mode).toBe('multi')
  })

  it('runs distinct configured models concurrently and stops both to quiescence', async () => {
    const { ctx, lead, adapter } = await setup(['hang', 'hang'], 2)
    await Promise.all(['b', 'c'].map(name => ctx.modelGroups.assign(lead, name, [{ type: 'text', text: `Task ${name}` }], false, signal)))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    expect(new Set(adapter.requests.map(request => request.model))).toEqual(new Set(['b', 'c']))
    for (const member of ctx.agentTeams.listMembers(lead).filter(member => member.role !== 'lead')) {
      const worker = ctx.agents.get(member.id)
      expect(worker).toBeDefined()
      expect(() => { worker?.model.select({ provider: 'mock', model: 'a' }) }).toThrow('active model group')
      expect(worker?.model.current()?.model).toBe(member.name)
    }
    expect(ctx.agentTeams.listTasks(lead).every(task => task.status === 'in_progress')).toBe(true)
    await ctx.modelGroups.stop(lead)
    expect(ctx.agentTeams.listMembers(lead).filter(member => member.role !== 'lead').every(member => member.status === 'inactive')).toBe(true)
    expect(adapter.requests).toHaveLength(2)
    await expect(ctx.modelGroups.assign(lead, 'b', [{ type: 'text', text: 'Late task' }], false, signal)).rejects.toThrow()
  })

  it('a stop during model preflight prevents later task creation and worker admission', async () => {
    const { ctx, lead, adapter } = await setup([])
    const entered = Promise.withResolvers<boolean>()
    const release = Promise.withResolvers<boolean>()
    const original = ctx.llm.resolveCallConfig.bind(ctx.llm)
    const spy = vi.spyOn(ctx.llm, 'resolveCallConfig').mockImplementation(async (request, active) => {
      entered.resolve(true)
      await release.promise
      active?.throwIfAborted()
      return original(request, active)
    })
    const assignment = ctx.modelGroups.assign(lead, 'b', [{ type: 'text', text: 'Delayed task' }], false, signal)
    const rejection = expect(assignment).rejects.toThrow()
    try {
      await entered.promise
      const stopping = ctx.modelGroups.stop(lead)
      release.resolve(true)
      await rejection
      await stopping
      expect(adapter.requests).toHaveLength(0)
      expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1)
      expect(ctx.agentTeams.listTasks(lead)).toHaveLength(0)
    } finally { release.resolve(true); spy.mockRestore() }
  })

  it('delivers a direct human mention to only that model and posts its attributed result', async () => {
    const { ctx, lead, adapter } = await setup([textResponse('Member answer')])
    const events: SessionEvent[] = []
    const dispose = ctx.on('session/event', (session, event) => { if (session.id === lead.id) events.push(event) })
    try {
      await ctx.commands.execute(lead, '/model-group tell b Answer this question', [], signal)
      await ctx.subagents.waitForChildren(lead)
      await lead.whenIdle()
      expect(adapter.requests.map(request => request.model)).toEqual(['b'])
      expect(adapter.requests[0]?.messages.some(message => message.content.some(block =>
        block.type === 'text' && block.text.includes(`Group conversation Session: ${lead.id}`)))).toBe(true)
      const posts = events.filter(event => event.type === 'model-group/post')
      expect(posts.some(event => event.type === 'model-group/post' && event.data.member === 'b' && event.data.text === 'Member answer')).toBe(true)
    } finally { dispose() }
  })

  it('records direct acceptance without completing an empty leader turn while the member runs', async () => {
    const { ctx, lead, adapter } = await setup(['hang'])
    await ctx.commands.execute(lead, '/model-group tell b Analyze this task', [], signal)
    await vi.waitFor(() => {
      expect(adapter.requests.map(request => request.model)).toEqual(['b'])
      expect(lead.session.snapshotEvents().some(event => event.type === 'model-group/dispatched')).toBe(true)
    })
    expect(lead.session.snapshotEvents().some(event => event.type === 'turn/start')).toBe(false)
    const delivery = lead.session.snapshotEvents().find(event => event.type === 'model-group/dispatched')
    expect(delivery?.type === 'model-group/dispatched' ? delivery.data : undefined)
      .toMatchObject({ accepted: [{ member: 'b', accepted: true }], failed: [], publicMessage: true })
    const input = lead.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')
    expect(delivery?.type === 'model-group/dispatched' ? delivery.data.requestSeq : undefined).toBe(input?.seq)
    expect(input?.type === 'user/message' ? input.data.content : undefined)
      .toEqual([{ type: 'text', text: '@b Analyze this task' }])
    const stored = await ctx.sessionPersistence.open(lead.id, 'read')
    try {
      expect((await stored.read()).events.some(event => event.type === 'model-group/dispatched')).toBe(true)
    } finally { await stored.close() }
    expect(ctx.agentTeams.listMembers(lead).find(member => member.name === 'b')?.status).toBe('running')
    await ctx.modelGroups.stop(lead)
  })

  it('retains human authorship when directly messaging an existing model again', async () => {
    const { ctx, lead, adapter } = await setup([textResponse('First answer'), textResponse('Second answer')])
    await ctx.commands.execute(lead, '/model-group tell b First question', [], signal)
    await ctx.subagents.waitForChildren(lead)
    await lead.whenIdle()
    await ctx.commands.execute(lead, '/model-group tell b Second question', [], signal)
    await ctx.subagents.waitForChildren(lead)
    await lead.whenIdle()
    expect(adapter.requests.map(request => request.model)).toEqual(['b', 'b'])
    const question = adapter.requests[1]?.messages.findLast(message => message.source?.kind === 'user')
    expect(question?.content.some(block => block.type === 'text' && block.text.includes('Second question'))).toBe(true)
  })

  it('changing plugin defaults affects later conversations while preserving existing choices', async () => {
    const { ctx, lead, fiber } = await setup([])
    const updated = members.map(member => ({ ...member, strengths: 'Updated strengths' }))
    fiber.update({ members: updated, leader: 'a', defaultMode: 'single' })
    await fiber.await()
    const next = await ctx.agentLoop.create(SessionId('new-default'), { provider: 'mock', model: 'a' })
    expect(ctx.modelGroups.snapshot(lead)?.mode).toBe('multi')
    expect(ctx.modelGroups.snapshot(lead)?.members).toEqual(updated)
    expect(ctx.modelGroups.snapshot(next)?.mode).toBe('single')
  })

  it('keeps the configured leader selected until single-model mode or plugin withdrawal', async () => {
    const { ctx, lead, fiber } = await setup([])
    expect(() => { lead.model.select({ provider: 'mock', model: 'c' }) }).toThrow('active model group')
    expect(lead.model.current()?.model).toBe('a')
    await ctx.modelGroups.setMode(lead, 'single')
    lead.model.select({ provider: 'mock', model: 'c' })
    expect(lead.model.current()?.model).toBe('c')
    await ctx.modelGroups.setMode(lead, 'multi')
    expect(lead.model.current()?.model).toBe('a')
    await fiber.dispose()
    lead.model.select({ provider: 'mock', model: 'c' })
    expect(lead.model.current()?.model).toBe('c')
  })

  it('retains the leader reasoning effort when the model-group runtime is reactivated', async () => {
    const { ctx, lead, fiber } = await setup([])
    const selection = { provider: 'mock', model: 'a', reasoningEffort: ReasoningEffortId('high') }
    lead.model.select(selection)
    await fiber.dispose()
    await ctx.plugin(ModelGroups, { members, leader: 'a' })
    expect(lead.model.current()).toEqual(selection)
  })

  it('unloading the plugin drains its running models and removes human controls', async () => {
    const { ctx, lead, fiber, adapter } = await setup(['hang'])
    await ctx.modelGroups.assign(lead, 'b', [{ type: 'text', text: 'Long task' }], true, signal)
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    await fiber.dispose()
    expect(ctx.commands.find(lead, 'model-group')).toBeUndefined()
    expect(ctx.agentTeams.listMembers(lead).find(member => member.name === 'b')?.status).toBe('inactive')
  })

  it('rejects unconfigured models and limits new activations without cancelling existing work', async () => {
    const { ctx, lead, adapter } = await setup(['hang'], 1)
    await expect(ctx.modelGroups.assign(lead, 'missing', [{ type: 'text', text: 'Task' }], false, signal)).rejects.toThrow('Unknown configured model')
    await ctx.modelGroups.assign(lead, 'b', [{ type: 'text', text: 'Task b' }], false, signal)
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    await expect(ctx.modelGroups.assign(lead, 'c', [{ type: 'text', text: 'Task c' }], false, signal)).rejects.toThrow('parallelism limit')
    expect(ctx.agentTeams.listMembers(lead).find(member => member.name === 'b')?.status).toBe('running')
    await ctx.modelGroups.stop(lead)
  })

  it('does not reuse a same-named teammate created by another coordinator', async () => {
    const { ctx, lead, adapter } = await setup(['hang', textResponse('Legacy work stopped')])
    const old = await ctx.agentTeams.spawnTeammate(lead, {
      name: 'b', description: 'Existing teammate', context: 'fresh', provider: 'spawn',
      agentOptions: { provider: 'mock', model: 'legacy-model' }, prompt: [{ type: 'text', text: 'Legacy task' }], signal,
    })
    await vi.waitFor(() => { expect(adapter.requests[0]?.model).toBe('legacy-model') })
    await expect(ctx.modelGroups.assign(lead, 'b', [{ type: 'text', text: 'New model task' }], true, signal))
      .rejects.toThrow('another coordinator')
    expect(ctx.agents.get(old.member.id)?.status).toBe('running')
    await ctx.subagents.drainChildren(lead, [old.member.id])
    await lead.whenIdle()
  })

  it('refuses conversion without interrupting another Team coordinator', async () => {
    const { ctx, lead, adapter } = await setup(['hang', textResponse('Legacy work stopped')])
    await ctx.modelGroups.setMode(lead, 'single')
    const old = await ctx.agentTeams.spawnTeammate(lead, {
      name: 'legacy', description: 'Existing teammate', context: 'fresh', provider: 'spawn',
      agentOptions: { provider: 'mock', model: 'legacy-model' }, prompt: [{ type: 'text', text: 'Legacy task' }], signal,
    })
    await vi.waitFor(() => { expect(adapter.requests[0]?.model).toBe('legacy-model') })
    const before = ctx.modelGroups.snapshot(lead)
    await expect(ctx.modelGroups.setMode(lead, 'multi')).rejects.toThrow('another Team coordinator')
    expect(ctx.modelGroups.snapshot(lead)).toBe(before)
    expect(ctx.agents.get(old.member.id)?.status).toBe('running')
    await ctx.subagents.drainChildren(lead, [old.member.id])
    await lead.whenIdle()
  })

  it('rejects a persisted teammate transition that changes its coordination owner', async () => {
    const { ctx, lead } = await setup(['hang'])
    await ctx.modelGroups.assign(lead, 'b', [{ type: 'text', text: 'Task' }], true, signal)
    let state = teamProjectionDefinition.init(lead.session.header)
    for (const event of lead.session.snapshotEvents()) {
      if (event.type === 'team/member' && event.data.member.phase === 'active') {
        state = teamProjectionDefinition.apply(state, { ...event, data: { ...event.data, member: { ...event.data.member, coordinationOwner: 'other' } } })
        break
      }
      state = teamProjectionDefinition.apply(state, event)
    }
    expect(state.failure).toContain('immutable identity')
    await ctx.modelGroups.stop(lead)
  })

  it('stopping one model preserves its peer and blocks automatic reassignment', async () => {
    const { ctx, lead, adapter } = await setup(['hang', 'hang'])
    await Promise.all(['b', 'c'].map(name => ctx.modelGroups.assign(lead, name, [{ type: 'text', text: `Task ${name}` }], true, signal)))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    await ctx.modelGroups.stop(lead, 'b')
    expect(ctx.agentTeams.listMembers(lead).find(member => member.name === 'c')?.status).toBe('running')
    await expect(ctx.modelGroups.assign(lead, 'b', [{ type: 'text', text: 'Restart' }], false, signal)).rejects.toThrow('user stopped')
    await ctx.modelGroups.stop(lead)
  })
})
