/**
 * Configurable model-group orchestration over Team and subagent lifecycles.
 * @module
 */
import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Agent, SessionStartSource } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-experimental-agent-team'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-subagent'
import { steerHostSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import { TeamTaskId } from '@deepseek-ai/dsh-experimental-agent-team'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { modelGroupProjection, type ModelGroupProjectionState } from './projection.ts'
import { memberSchema } from './schema.ts'
import type { ModelGroupDispatchReceipt, ModelGroupMember, ModelGroupMode, ModelGroupSnapshot } from './types.ts'
import { ModelGroupError } from './error.ts'
export { ModelGroupError } from './error.ts'
export type * from './types.ts'

const LEADER_POLICY = 'In model-group mode, assign work to other models only through model_group_assign. Perform your own contribution directly; never assign a task to yourself. Member replies are already public in the group. Speak as yourself and give a concise synthesis instead of reproducing each member’s full reply. Assignment creates a shared task automatically: create tasks separately only when dependencies or shared-file coordination require them. This coordination policy takes precedence over general Team or subagent delegation guidance. Include complete instructions and required context: each model keeps a separate history. Respect the user’s selected models and stop actions.'
const MEMBER_POLICY = 'You are a model-group member; the parent Session is the leader. Complete assigned work directly. Your text replies are published to the group and your settled result reaches the leader automatically; return the complete answer in your reply instead of sending a duplicate result message. Do not start other agents or workflows. Ask the leader for missing context through the available messaging tools. This policy takes precedence over general delegation guidance.'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Legacy direct-delivery notice retained for pending inbox records; no leader response is requested. */
    'model-group': { readonly kind: 'model-group'; readonly form: 'notice'; readonly summary: string }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { modelGroups: ModelGroups }
}

/**
 * Live member defaults follow unused conversations; started conversations retain their routes.
 */
export interface Config {
  /** Execution mode captured by subsequently created conversations. */
  readonly defaultMode: Volatile<ModelGroupMode>
  /** Name of the configured model that coordinates new groups. */
  readonly leader: Volatile<string>
  /** Exact model routes and editable strengths followed until a conversation starts. */
  readonly members: Volatile<ModelGroupMember[]>
  /** Live worker-model limit per group; the leader does not consume a slot. */
  readonly maxParallel: Volatile<number>
}

/**
 * Model groups with independent model routes, shared tasks, and direct human addressing.
 */
export class ModelGroups extends Service {
  static inject = ['agents', 'sessions', 'sessionProjections', 'sessionPersistence', 'subagents', 'agentTeams', 'commands', 'tools', 'systemPrompt', 'llm']
  static Config = Schema.object({
    defaultMode: Schema.union(['multi', 'single']).default('multi').volatile(),
    leader: Schema.string().default('').volatile(),
    members: Schema.array(Schema.object({
      name: Schema.string().required(), label: Schema.string().required(),
      provider: Schema.string().required(), model: Schema.string().required(), strengths: Schema.string().default(''),
    })).default([]).volatile(),
    maxParallel: Schema.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(3).volatile(),
  })

  private projection!: ProjectionHandle<ModelGroupProjectionState>
  private readonly reservations = new Map<Agent, Set<string>>()
  private readonly installed = new Map<Agent, () => void>()
  private readonly lifetime = new AbortController()
  private readonly pending = new Map<Promise<unknown>, Agent>()
  private readonly rounds = new Map<Agent, AbortController>()
  private readonly stopping = new Map<Agent, Promise<void>>()

  /**
   * @param ctx - Host services composing Teams and authenticated human commands.
   * @param config - Live plugin defaults.
   */
  constructor(ctx: Context, private readonly config: Config) { super(ctx, 'modelGroups') }

  protected async [Service.init](): Promise<void> {
    this.defaults()
    this.ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, this.ctx.fiber)) })
    this.projection = await this.ctx.sessionProjections.register(modelGroupProjection)
    this.ctx.on('loader/volatile-update', () => {
      for (const agent of this.installed.keys()) if (this.refreshUnused(agent)) this.selectLeader(agent)
    })
    this.ctx.effect(() => this.ctx.agents.guardModelSelection((agent, selection) => {
      if (this.lifetime.signal.aborted) return undefined
      let root = agent
      let name: string | undefined
      if (agent.session.header.origin === 'subagent') {
        const parent = agent.session.header.parentSession
        const owner = parent === undefined ? undefined : this.ctx.agents.get(parent)
        if (owner === undefined) return undefined
        const member = this.ctx.agentTeams.listMembers(owner).find(member => member.id === agent.id)
        if (member?.coordinationOwner !== 'model-group') return undefined
        root = owner; name = member.name
      }
      const group = this.snapshot(root)
      const member = group?.mode === 'multi' ? group.members.find(member => member.name === (name ?? group.leader)) : undefined
      return member !== undefined && (member.provider !== selection.provider || member.model !== selection.model)
        ? 'This model is selected by the active model group. Switch the conversation to single-model mode to choose another model.' : undefined
    }), 'model-group: model choice policy')
    this.ctx.on('agent/created', ({ agent, source }) => { this.initialize(agent, source) })
    this.ctx.on('agent/disposed', ({ agent }) => { this.installed.get(agent)?.(); this.installed.delete(agent); this.reservations.delete(agent); this.rounds.delete(agent) })
    this.ctx.on('session/event', (session, event) => { this.postMemberOutput(session, event) })
    this.ctx.on('subagent/end', (info) => {
      const parent = [...this.installed.keys()].find(agent => agent.session.header.origin !== 'subagent'
        && this.ctx.agentTeams.listMembers(agent).some(member => member.id === info.id && member.coordinationOwner === 'model-group'))
      if (parent === undefined) return
      const admissions = [...this.pending].filter(([, root]) => root === parent).map(([operation]) => operation)
      const operation = Promise.allSettled(admissions).then(async () => {
        const group = this.snapshot(parent)
        const row = this.ctx.agentTeams.listMembers(parent).find(member => member.id === info.id)
        const member = group?.members.find(member => member.name === row?.name)
        if (member === undefined) return
        if (info.stopReason !== 'completed' && group?.stopped !== true) parent.session.append('model-group/post', {
          member: member.name, label: member.label, text: '', failure: info.stopReason, sourceSession: info.id,
        })
        for (const task of this.ctx.agentTeams.listTasks(parent)) {
          if (task.ownerName !== member.name || task.status !== 'in_progress') continue
          await this.ctx.agentTeams.updateTask(parent, { taskId: task.id, expectedRevision: task.revision, action: info.stopReason === 'completed' ? 'complete' : 'release' })
        }
      })
      this.pending.set(operation, parent)
      void operation.catch((error: unknown) => { this.ctx.logger.error('Model-group settlement failed', error) }).finally(() => { this.pending.delete(operation) })
    })
    this.ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
      const decision = await next()
      const group = this.snapshot(agent)
      if (decision.kind !== 'enter' || group?.mode !== 'multi') return decision
      const human = messages.some(message => message.source.kind === 'user')
      if (human && group.stopped) {
        agent.session.append('model-group/stopped', { stopped: false })
        if (this.rounds.get(agent)?.signal.aborted !== false) this.rounds.set(agent, new AbortController())
      }
      if (human && group.stoppedMembers.length > 0) {
        agent.session.append('model-group/configured', { ...this.snapshot(agent) ?? group, stoppedMembers: [] })
      }
      const admittedMessage = (message: (typeof messages)[number]): boolean => {
        if (message.source.kind === 'model-group') return false
        if (message.source.kind !== 'subagent-settled') return !group.stopped || human
        const sender = message.source.senderSessionId
        const member = this.ctx.agentTeams.listMembers(agent).find(member => member.id === sender)
        return !group.stopped && !group.direct.includes(member?.name ?? '')
      }
      if ((!human && group.stopped) || (messages.length > 0 && !messages.some(admittedMessage))) return { kind: 'reject' }
      const admitted = decision.messages.filter(admittedMessage)
      return { ...decision, messages: admitted }
    })
    this.ctx.effect(() => this.ctx.commands.register({
      name: 'model-group', description: 'Select single-model or model-group mode, address a model, or stop collaboration.',
      input: { hint: 'single | multi | stop [member] | tell <member> <message>', attachments: true }, recordInput: false,
      handler: async ({ agent, rawInput, attachments, signal }) => {
        this.requireRoot(agent)
        const line = rawInput.trim()
        if (line === 'single' || line === 'multi') { await this.setMode(agent, line); return { kind: 'success' } }
        if (line === 'stop' || line.startsWith('stop ')) { await this.stop(agent, line.slice(5).trim() || undefined); return { kind: 'success' } }
        const match = /^tell\s+(\S+)\s+([\s\S]+)$/.exec(line)
        if (match === null || match[1] === undefined || match[2] === undefined) return { kind: 'error', text: 'Use single, multi, stop [member], or tell <member> <message>.' }
        const targets = [...new Set(match[1].split(','))]
        const text = match[2]
        const group = this.snapshot(agent)
        if (group?.mode !== 'multi') throw new ModelGroupError('GROUP_DISABLED', 'Enable model-group mode before addressing members')
        for (const target of targets) if (!group.members.some(member => member.name === target)) throw new ModelGroupError('GROUP_MODEL_UNAVAILABLE', `Unknown configured model: ${target}`)
        const publicText = targets.every(target => text.includes(`@${target}`)) ? text : `${targets.map(target => `@${target}`).join(' ')} ${text}`
        const directInput = !targets.includes(group.leader)
        const posted = targets.length === 1 && targets[0] === group.leader ? undefined
          : directInput ? agent.session.append('user/message', createUserMessage({
            content: [{ type: 'text', text: publicText }, ...attachments], source: { kind: 'user' },
          }), { surfaceOp: 'append' })
            : agent.session.append('model-group/post', { member: 'user', label: 'user', text: publicText, sourceSession: agent.id })
        const results = await Promise.allSettled(targets.map(target => this.assign(agent, target, [{ type: 'text', text }, ...attachments], true, signal)))
        const failed = targets.filter((_target, index) => results[index]?.status === 'rejected')
        if (posted !== undefined) {
          agent.session.append('model-group/dispatched', {
            requestSeq: posted.seq,
            accepted: results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []),
            failed,
            ...directInput ? { publicMessage: true as const } : {},
          })
          await this.ctx.sessions.flush(agent.session)
        }
        if (failed.length > 0) {
          const accepted = targets.filter((_target, index) => results[index]?.status === 'fulfilled')
          const details = results.flatMap((result, index) => result.status === 'rejected'
            ? [`${targets[index]}: ${result.reason instanceof Error ? result.reason.message : 'delivery failed'}`] : [])
          throw new ModelGroupError('GROUP_PARTIAL_DELIVERY', `Confirmed: ${accepted.join(', ') || 'none'}. Failed or unconfirmed: ${details.join('; ')}. Check their execution records before retrying.`)
        }
        return { kind: 'success', ...posted === undefined ? {} : { sourceEventSeq: posted.seq } }
      },
    }), 'model-group: human commands')
    for (const agent of this.ctx.agents.list()) this.initialize(agent, 'resume')
    this.ctx.effect(() => async () => {
      this.lifetime.abort(new Error('Model-group plugin unloaded'))
      const roots = [...this.installed.keys()].filter(agent =>
        agent.session.header.origin !== 'subagent' && this.ctx.agents.get(agent.id) === agent)
      for (const root of roots) { this.rounds.get(root)?.abort(); if (this.snapshot(root)?.mode === 'multi') root.cancel({ kind: 'disposed' }) }
      await Promise.allSettled([...this.pending.keys()])
      await Promise.allSettled([...this.stopping.values()])
      const drained = await Promise.allSettled(roots.map(async (root) => {
        const ids = this.ctx.agentTeams.listMembers(root)
          .filter(member => member.coordinationOwner === 'model-group').map(member => member.id)
        await this.ctx.subagents.drainChildren(root, ids)
      }))
      await Promise.allSettled([...this.pending.keys()])
      for (const dispose of this.installed.values()) dispose()
      this.installed.clear()
      this.rounds.clear()
      const failures: unknown[] = []
      for (const result of drained) if (result.status === 'rejected') failures.push(result.reason)
      if (failures.length > 0) throw new AggregateError(failures, 'Model-group execution cleanup failed')
    }, 'model-group: runtime')
  }

  /**
   * Read one conversation's durable model-group selection.
   * @param agent - Exact live root.
   * @returns Its group selection, if configured.
   */
  snapshot(agent: Agent): ModelGroupSnapshot | null { return this.projection.stateOf(agent.session).group }

  /**
   * Change only this conversation after stopping existing executions.
   * @param agent - Live root.
   * @param mode - Desired mode.
   */
  async setMode(agent: Agent, mode: ModelGroupMode): Promise<void> {
    this.requireRoot(agent)
    const prior = this.snapshot(agent)
    if (prior?.mode === mode) return
    const foreign = this.ctx.agentTeams.listMembers(agent).some(member => member.role !== 'lead' && member.coordinationOwner !== 'model-group')
    if (mode === 'multi' && foreign) throw new ModelGroupError('GROUP_MODEL_BUSY', 'This conversation has another Team coordinator; start a new group conversation')
    if (prior?.mode === 'multi' || mode === 'multi') await this.stop(agent)
    this.lifetime.signal.throwIfAborted()
    const group = prior ?? this.defaults()
    const selected = mode === 'multi' && group.members.length === 0 ? this.defaults() : group
    agent.session.append('model-group/configured', { ...selected, mode, stopped: false })
    this.rounds.set(agent, new AbortController())
    this.selectLeader(agent)
    await this.ctx.sessions.flush(agent.session)
  }

  /**
   * Stop current work and close new assignment admission.
   * @param agent - Live root.
   * @param member - Optional single model name.
   */
  async stop(agent: Agent, member?: string): Promise<void> {
    this.requireRoot(agent)
    const roster = this.ctx.agentTeams.listMembers(agent)
    if (member !== undefined) {
      const target = roster.find(candidate => candidate.name === member && candidate.id !== agent.id)
      if (target === undefined || target.coordinationOwner !== 'model-group') throw new Error(`Unknown active model-group member: ${member}`)
      agent.session.append('model-group/member-stopped', { member })
      this.ctx.subagents.interrupt(target.id, { kind: 'ancestor', agent })
      await this.ctx.agents.get(target.id)?.whenIdle()
      return
    }
    const current = this.stopping.get(agent)
    if (current !== undefined) return current
    const operation = this.stopGroup(agent)
    this.stopping.set(agent, operation)
    try { await operation }
    finally { this.stopping.delete(agent) }
  }

  private async stopGroup(agent: Agent): Promise<void> {
    if (this.snapshot(agent) !== null) agent.session.append('model-group/stopped', { stopped: true })
    this.rounds.get(agent)?.abort(new Error('Model-group round stopped'))
    agent.cancel({ kind: 'user' })
    await Promise.allSettled([...this.pending].filter(([, root]) => root === agent).map(([operation]) => operation))
    const roster = this.ctx.agentTeams.listMembers(agent)
    await this.ctx.subagents.drainChildren(agent, roster.filter(member => member.coordinationOwner === 'model-group').map(member => member.id))
    await Promise.allSettled([...this.pending].filter(([, root]) => root === agent).map(([operation]) => operation))
    await agent.whenIdle()
  }

  /**
   * Dispatch one admitted model task.
   * @param agent - Live leader.
   * @param name - Configured model name.
   * @param prompt - Logged task input.
   * @param direct - Human-directed delivery.
   * @param signal - Admission cancellation.
   * @param taskId - Existing ready task; omission creates a new task.
   * @returns Accepted model, target Session, and shared task identities.
   */
  assign(
    agent: Agent, name: string, prompt: ContentBlock[], direct: boolean, signal: AbortSignal, taskId?: TeamTaskId,
  ): Promise<ModelGroupDispatchReceipt> {
    if (this.stopping.has(agent)) return Promise.reject(new ModelGroupError('GROUP_STOPPED', 'Wait for the current group stop to finish'))
    let round = this.rounds.get(agent)
    if (round === undefined || (round.signal.aborted && direct)) { round = new AbortController(); this.rounds.set(agent, round) }
    const activeSignal = AbortSignal.any([signal, this.lifetime.signal, round.signal])
    const operation = this.assignAdmitted(agent, name, prompt, direct, activeSignal, taskId)
    this.pending.set(operation, agent)
    void operation.finally(() => { this.pending.delete(operation) }).catch(() => {})
    return operation
  }

  private defaults(): ModelGroupSnapshot {
    const members = this.config.members.get().map(member => memberSchema.parse(member))
    const leader = this.config.leader.get()
    if (new Set(members.map(member => member.name)).size !== members.length) throw new ModelGroupError('GROUP_INVALID_CONFIG', 'Model-group member names must be unique')
    if (members.length > 0 && !members.some(member => member.name === leader)) throw new ModelGroupError('GROUP_INVALID_CONFIG', 'Select one group member as leader')
    return { mode: this.config.defaultMode.get(), leader, members, stopped: false, direct: [], stoppedMembers: [] }
  }

  private requireRoot(agent: Agent): void {
    if (this.lifetime.signal.aborted) throw new ModelGroupError('GROUP_STOPPED', 'The model-group plugin is stopping')
    if (this.ctx.agents.get(agent.id) !== agent || agent.session.header.origin === 'subagent') throw new ModelGroupError('GROUP_UNAUTHORIZED', 'Model-group operations require the live conversation leader')
  }

  private initialize(agent: Agent, source: SessionStartSource): void {
    if (this.installed.has(agent)) return
    const parentId = agent.session.header.origin === 'subagent' ? agent.session.header.parentSession : undefined
    if (parentId !== undefined) {
      const parent = this.ctx.agents.get(parentId)
      const member = parent === undefined ? undefined : this.ctx.agentTeams.listMembers(parent).find(member => member.id === agent.id)
      if (parent !== undefined && this.snapshot(parent)?.mode === 'multi' && member?.coordinationOwner === 'model-group') this.installTasks(agent)
      return
    }
    if ((source === 'startup' || agent.session.requestHeader() === undefined) && this.snapshot(agent) === null) agent.session.append('model-group/configured', this.defaults())
    this.refreshUnused(agent)
    this.selectLeader(agent)
    const scoped = agent.ctx
    const disposers = [scoped.systemPrompt.context({
      name: 'model-group', required: true, order: scoped.systemPrompt.getContextOrder('TEAM_IDENTITY'),
      text: () => {
        const group = this.snapshot(agent)
        if (group?.mode !== 'multi') return ''
        const leader = group.members.find(member => member.name === group.leader)
        const workers = group.members.filter(member => member.name !== group.leader)
        return `You coordinate a group whose members are models, without fixed roles. You are ${group.leader}${leader === undefined ? '' : ` (${leader.label})`}, the leader. Give your own answer directly; do not delegate to yourself.\nOther models available for assignment: ${JSON.stringify(workers)}${group.stoppedMembers.length === 0 ? '' : `\nModels stopped by the user: ${JSON.stringify(group.stoppedMembers)}`}\nRespect models the user explicitly selects. Otherwise choose by task requirements and the supplied strengths. Explain your task understanding and assignment briefly before dispatch. Use model_group_assign for independent tasks together, then continue useful work. Each assignment creates a shared task unless task_id reuses an existing one; ordinary discussion needs no separate task-creation calls. A settled model reports its result; finish your turn when only waiting remains. Use the shared task board to record dependencies and write scopes when needed. Coordinate shared-file writes; write-scope hints are not locks. Read completed results before the final synthesis. A direct human @ request belongs to its selected model and needs no extra leader answer. Models stopped by the user cannot receive automatic assignments until another human request. ${workers.length === 0 ? 'No additional models are configured; complete the task yourself.' : ''}`
      },
    }), scoped.tools.register(defineTool({
      name: 'model_group_assign',
      description: 'Assign a task to another configured model; never assign to yourself. Creates a shared task unless task_id reuses an existing one. Provide complete instructions and necessary context: models keep separate histories. Independent assignments may run together. Returns after inbox acceptance.',
      parameters: {
        model: { type: 'string', required: true, description: 'Exact alias of another model from the assignment roster, excluding the leader.' },
        task: { type: 'string', required: true, description: 'Complete task instructions, relevant context, and file or Session references.' },
        task_id: { type: 'string', description: 'Existing ready shared task id; omit or leave empty to create a new task.' },
      },
      output: {
        schema: { type: 'object', properties: {
          member: { type: 'string', required: true }, sessionId: { type: 'string', required: true },
          taskId: { type: 'string' }, accepted: { type: 'boolean', const: true, required: true },
        }, additionalProperties: false },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args, exec) => {
        if (exec.agent !== agent) throw new ModelGroupError('GROUP_UNAUTHORIZED', 'Only the conversation leader may assign group work')
        const taskId = args.task_id === undefined || args.task_id.trim() === '' ? undefined : TeamTaskId(args.task_id)
        return this.assign(agent, args.model, [{ type: 'text', text: args.task }], false, exec.signal, taskId)
      },
      presentCall: args => ({ card: 'generic', title: args.model, rawInput: args.task }),
    }), { when: ({ agent: caller }) => caller === agent && this.snapshot(agent)?.mode === 'multi' }), scoped.tools.guard((exec) => {
      if (this.snapshot(agent)?.mode !== 'multi') return undefined
      return ['subagent', 'subagent_fork', 'spawn_teammate', 'workflow'].includes(exec.name)
        ? 'Use model_group_assign to delegate only to this group’s configured models.' : undefined
    })]
    const disposeTasks = this.installTasks(agent)
    this.installed.set(agent, () => { disposeTasks(); for (const dispose of disposers.reverse()) dispose() })
  }

  private refreshUnused(agent: Agent): boolean {
    if (agent.status !== 'idle' || agent.session.header.origin === 'subagent') return false
    if ([...this.pending.values()].includes(agent)) return false
    const state = this.projection.stateOf(agent.session)
    if (state.used || state.group === null) return false
    const defaults = this.defaults()
    const current = state.group
    if (current.leader === defaults.leader && JSON.stringify(current.members) === JSON.stringify(defaults.members)) return false
    agent.session.append('model-group/configured', { ...current, leader: defaults.leader, members: defaults.members })
    return true
  }

  private selectLeader(agent: Agent): void {
    const group = this.snapshot(agent)
    const leader = group?.mode === 'multi' ? group.members.find(member => member.name === group.leader) : undefined
    if (leader === undefined) return
    const current = agent.model.current()
    agent.model.select(current?.provider === leader.provider && current.model === leader.model
      ? current : { provider: leader.provider, model: leader.model })
  }

  private async assignAdmitted(
    agent: Agent, name: string, prompt: ContentBlock[], direct: boolean, signal: AbortSignal, taskId?: TeamTaskId,
  ): Promise<ModelGroupDispatchReceipt> {
    this.requireRoot(agent)
    const group = this.snapshot(agent)
    if (group?.mode !== 'multi') throw new ModelGroupError('GROUP_DISABLED', 'Model-group mode is not enabled for this conversation')
    if (group.stopped && !direct) throw new ModelGroupError('GROUP_STOPPED', 'This model-group round was stopped')
    if (group.stoppedMembers.includes(name) && !direct) throw new ModelGroupError('GROUP_STOPPED', 'The user stopped this model; wait for another human request')
    const selected = group.members.find(member => member.name === name)
    if (selected === undefined) throw new ModelGroupError('GROUP_MODEL_UNAVAILABLE', `Unknown configured model: ${name}`)
    signal.throwIfAborted()
    if (direct && group.stopped) agent.session.append('model-group/stopped', { stopped: false })
    if (direct && group.stoppedMembers.includes(name)) {
      agent.session.append('model-group/configured', { ...this.snapshot(agent) ?? group, stoppedMembers: group.stoppedMembers.filter(member => member !== name) })
    }
    if (name === group.leader) {
      if (!direct) throw new ModelGroupError('GROUP_SELF_ASSIGNMENT', 'You are the leader. Answer your part directly and assign only to the other models.')
      agent.session.append('model-group/stopped', { stopped: false })
      agent.steer(createUserMessage({ content: prompt, source: { kind: 'user' } }))
      return { member: name, sessionId: agent.id, accepted: true }
    }
    const reservations = this.reservations.get(agent) ?? new Set<string>()
    this.reservations.set(agent, reservations)
    const roster = this.ctx.agentTeams.listMembers(agent)
    if (reservations.has(name)) throw new ModelGroupError('GROUP_MODEL_BUSY', `Model ${name} is being started; retry after acceptance`)
    const existing = roster.find(member => member.name === name)
    if (existing !== undefined && existing.coordinationOwner !== 'model-group') {
      throw new ModelGroupError('GROUP_MODEL_BUSY', `Model alias ${name} is already used by another coordinator; start a new group conversation`)
    }
    if (existing?.status === 'running' && !direct) throw new ModelGroupError('GROUP_MODEL_BUSY', `Model ${name} is busy; wait for its current task to finish`)
    const active = new Set(roster.filter(member => member.coordinationOwner === 'model-group'
      && (member.status === 'running' || member.status === 'provisioning')).map(member => member.name))
    for (const member of reservations) active.add(member)
    if (!active.has(name) && active.size >= this.config.maxParallel.get()) throw new ModelGroupError('GROUP_CAPACITY', 'Model-group parallelism limit reached; wait for a model to finish')
    reservations.add(name)
    try {
      await this.ctx.llm.resolveCallConfig({ provider: selected.provider, model: selected.model }, signal)
      signal.throwIfAborted()
      const text = prompt.filter(block => block.type === 'text').map(block => block.text).join('\n')
      const [subject = ''] = text.split('\n')
      const task = taskId === undefined
        ? await this.ctx.agentTeams.createTask(agent, { subject: subject.slice(0, 200), description: text })
        : this.ctx.agentTeams.getTask(agent, taskId)
      if (task.status !== 'pending' || !task.ready) throw new ModelGroupError('GROUP_MODEL_BUSY', `Task ${task.id} is not ready for assignment`)
      const taskPrompt: ContentBlock[] = [{ type: 'text', text: `Shared task ${task.id}. Group conversation Session: ${agent.id}. Use the available session-query tools to read earlier group messages when the task refers to them. Return the complete requested answer in your reply; task completion is recorded automatically when your run finishes. Use model_group_tasks only when you need to coordinate dependencies or shared work.` }, ...prompt]
      if (existing?.status !== 'running') agent.session.append('model-group/delivery', { member: name, direct })
      let sessionId: SessionId
      if (existing !== undefined) {
        if (direct) await steerHostSubagentPrompt(this.ctx.subagents, agent, existing.id, taskPrompt, { kind: 'user' }, signal)
        else await this.ctx.agentTeams.sendMessage(agent, { target: name, content: taskPrompt, signal })
        sessionId = existing.id
      } else {
        const spawned = await this.ctx.agentTeams.spawnTeammate(agent, {
          name, description: selected.label, prompt: taskPrompt, context: 'fresh', provider: 'spawn',
          coordinationOwner: 'model-group',
          agentOptions: { provider: selected.provider, model: selected.model, reasoningEffort: undefined }, signal,
        })
        sessionId = spawned.member.id
      }
      const current = this.ctx.agentTeams.getTask(agent, task.id)
      if (current.status === 'pending') await this.ctx.agentTeams.updateTask(agent, { taskId: task.id, expectedRevision: current.revision, action: 'reassign', owner: name })
      return { member: name, sessionId, taskId: task.id, accepted: true }
    } finally { reservations.delete(name) }
  }

  private installTasks(agent: Agent): () => void {
    const parentId = agent.session.header.origin === 'subagent' ? agent.session.header.parentSession : undefined
    const root = parentId === undefined ? agent : this.ctx.agents.get(parentId)
    const policy = agent.ctx.systemPrompt.section({
      name: 'model-group:policy', order: agent.ctx.systemPrompt.getSectionOrder('TEAM_POLICY'),
      text: () => root !== undefined && this.snapshot(root)?.mode === 'multi' ? parentId === undefined ? LEADER_POLICY : MEMBER_POLICY : '',
    })
    const guard = parentId === undefined ? () => {} : agent.ctx.tools.guard(exec =>
      ['subagent', 'subagent_fork', 'spawn_teammate', 'workflow', 'model_group_assign'].includes(exec.name)
        ? 'Only the model-group leader may start other models.' : undefined)
    const taskTool = agent.ctx.tools.register(defineTool({
      name: 'model_group_tasks', description: 'Read and update the shared task board. Read the latest revision before completing or releasing a task.',
      parameters: {
        action: { type: 'string', required: true, enum: ['list', 'create', 'claim', 'complete', 'release', 'set_dependencies'] },
        task: { type: 'string', description: 'Shared task id for an update, such as task-1.' },
        revision: { type: 'integer', description: 'Current task revision read from the task board.' },
        subject: { type: 'string' }, description: { type: 'string' },
        blocked_by: { type: 'array', items: { type: 'string' } }, write_scopes: { type: 'array', items: { type: 'string' } },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async (args, exec) => {
        if (exec.agent !== agent) throw new ModelGroupError('GROUP_UNAUTHORIZED', 'Use the current member’s task board')
        if (args.action === 'list') return JSON.stringify(this.ctx.agentTeams.listTasks(agent))
        if (args.action === 'create') {
          if (args.subject === undefined || args.description === undefined) throw new Error('A task subject and description are required')
          return JSON.stringify(await this.ctx.agentTeams.createTask(agent, {
            subject: args.subject, description: args.description,
            ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
            ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
          }))
        }
        if (args.task === undefined || args.revision === undefined) throw new Error('A task id and current revision are required')
        return JSON.stringify(await this.ctx.agentTeams.updateTask(agent, {
          taskId: TeamTaskId(args.task), expectedRevision: args.revision, action: args.action,
          ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
        }))
      },
      presentCall: args => ({ card: 'generic', title: `${args.action} shared tasks`, rawInput: args.subject ?? args.task }),
    }), { when: ({ agent: caller }) => {
      return caller === agent && root !== undefined && this.snapshot(root)?.mode === 'multi'
    } })
    const dispose = (): void => { taskTool(); guard(); policy() }
    if (!this.installed.has(agent)) this.installed.set(agent, dispose)
    return dispose
  }

  private postMemberOutput(session: Session, event: SessionEvent): void {
    if (event.type !== 'assistant/message' || session.header.origin !== 'subagent') return
    const parentId = session.header.parentSession
    if (parentId === undefined) return
    const parent = this.ctx.agents.get(parentId)
    if (parent === undefined) return
    const group = this.snapshot(parent)
    if (group === null) return
    const member = this.ctx.agentTeams.listMembers(parent).find(member => member.id === session.id)
    if (member?.coordinationOwner !== 'model-group') return
    const configured = group.members.find(candidate => candidate.name === member.name)
    if (configured === undefined) return
    const text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    if (text === '') return
    parent.session.append('model-group/post', { member: configured.name, label: configured.label, text, sourceSession: session.id, sourceSeq: event.seq })
  }
}

export default ModelGroups
