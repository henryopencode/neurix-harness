/** Agent Teams service façade over roster, messaging, task, and runtime lifecycle owners. */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-settings'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { steerHostSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import { TeamActivity } from './activity.ts'
import { errorMessage, TeamError } from './error.ts'
import { TeamJournal } from './journal.ts'
import { TeamRuntimeLifecycle } from './lifecycle.ts'
import { teamProjectionDefinition } from './projection.ts'
import { resolveActiveMember, TeamRoster } from './roster.ts'
import type { TeamMembership } from './roster.ts'
import { TeamTaskBoard } from './task-board.ts'
import { TeamModels } from './models.ts'
import { TeamId, TeamTaskId } from './types.ts'
import type {
  Config,
  CreateTeamTaskRequest,
  SendTeamMessageRequest,
  SendTeamMessageResult,
  SpawnTeammateRequest,
  SpawnTeammateResult,
  TeamMemberView,
  TeamTaskView,
  TeamWaitResult,
  TeamModelSelection,
  UpdateTeamTaskRequest,
} from './types.ts'

export type * from './types.ts'
export type { TeamMembership } from './roster.ts'
export { TeamId, TeamMessageId, TeamTaskId } from './types.ts'
export { TeamError } from './error.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentTeams: TeamService
  }
}

const DEFAULT_MAX_MEMBERS = 16
const DEFAULT_MAX_TASKS = 256
const DEFAULT_MAX_MESSAGE_BYTES = 65_536
const DEFAULT_DISPOSAL_TIMEOUT_MS = 5_000

/** Validate one positive safe-integer deployment limit. */
function positiveLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TeamError(`${name} must be a positive safe integer`, 'TEAM_INVALID_CONFIG')
  }
  return value
}

/** Agent Teams service backed by the exact live Lead Session log. */
export class TeamService extends Service {
  static inject = ['agents', 'sessions', 'sessionPersistence', 'sessionProjections', 'subagents', 'llm']

  static Config = z.object({
    models: z.array(z.object({ name: z.string().required(), label: z.string().required(), provider: z.string().required(),
      model: z.string().required(), strengths: z.string().default('') })).default([]).volatile(),
    leaderModel: z.string().default('').volatile(),
    maxParallel: z.number().step(1).min(1).default(3).volatile(),
    maxMembers: z.number().step(1).min(1).default(DEFAULT_MAX_MEMBERS),
    maxTasks: z.number().step(1).min(1).default(DEFAULT_MAX_TASKS),
    maxMessageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_BYTES),
    disposalTimeoutMs: z.number().step(1).min(1).default(DEFAULT_DISPOSAL_TIMEOUT_MS),
  })

  /** Validated deployment limits used by every Team operation. */
  private readonly config: Required<Omit<Config, 'models' | 'leaderModel' | 'maxParallel'>>
  private readonly models: TeamModels
  private readonly stopping = new Map<Agent, Promise<void>>()

  private readonly activity: TeamActivity
  private readonly lifecycle: TeamRuntimeLifecycle
  private journal!: TeamJournal
  private roster!: TeamRoster
  private tasks!: TeamTaskBoard

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'agentTeams')
    this.config = {
      maxMembers: positiveLimit('maxMembers', config.maxMembers ?? DEFAULT_MAX_MEMBERS),
      maxTasks: positiveLimit('maxTasks', config.maxTasks ?? DEFAULT_MAX_TASKS),
      maxMessageBytes: positiveLimit('maxMessageBytes', config.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES),
      disposalTimeoutMs: positiveLimit(
        'disposalTimeoutMs',
        config.disposalTimeoutMs ?? DEFAULT_DISPOSAL_TIMEOUT_MS,
      ),
    }

    this.activity = new TeamActivity()
    this.lifecycle = new TeamRuntimeLifecycle(this.config.disposalTimeoutMs)
    this.models = new TeamModels(ctx, config, agent => this.roster.list(this.roster.membership(agent)))
  }

  protected async [Service.init](): Promise<void> {
    const ctx = this.ctx
    const teamProjectionHandle = await ctx.sessionProjections.register(teamProjectionDefinition)
    this.journal = new TeamJournal(ctx, teamProjectionHandle, (root) => { this.activity.notify(TeamId(root.id)) })
    this.roster = new TeamRoster(ctx, this.journal, this.lifecycle, this.config.maxMembers)
    this.tasks = new TeamTaskBoard(this.journal, this.config.maxTasks)
    await this.models.initialize()
    ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
    ctx.effect(() => () => this.disposeRuntime(), 'agentTeams.runtimeLifecycle()')

    ctx.on('agent/created', ({ agent }) => { this.scheduleRecovery(agent) })
    ctx.on('agent/status', ({ agent }) => {
      const membership = this.roster.tryMembership(agent)
      if (membership !== undefined) this.activity.notify(membership.id)
    })
    for (const agent of ctx.agents.list()) this.scheduleRecovery(agent)
  }

  /**
   * Resolve one exact live Agent's Team role.
   * @param agent - exact live Agent used as the authority credential.
   * @returns its root, Team identity, role, and model-facing name.
   */
  membership(agent: Agent): TeamMembership {
    return this.roster.membership(agent)
  }

  /**
   * List the runtime-enriched roster visible to one Team member.
   * @param agent - exact live Team member.
   * @returns Lead and teammate rows in creation order.
   */
  listMembers(agent: Agent): TeamMemberView[] {
    return this.roster.list(this.roster.membership(agent))
  }

  /**
   * Create one named, continuable direct child of the Team Lead.
   * @param caller - exact live Lead Agent.
   * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
   * @returns the active roster row.
   */
  async spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult> {
    const membership = this.roster.membership(caller)
    if (membership.role !== 'lead') throw new TeamError('only the Team Lead can create teammates', 'TEAM_LEAD_REQUIRED')
    const options = this.models.resolve(caller, request)
    const release = this.models.reserve(caller, request.name)
    return this.lifecycle.track((async () => { try {
      if (request.model !== undefined && options?.provider !== undefined && options.model !== undefined) {
        const available = await this.ctx.llm.listModels(options.provider)
        if (!available.some(model => model.id === options.model)) throw new TeamError('The selected Team model is unavailable; update its provider settings', 'TEAM_MODEL_UNAVAILABLE')
      }
      this.models.assertAdmission(caller, request.name)
      return await this.roster.spawn(caller, { ...request, ...options === undefined ? {} : { agentOptions: options } })
    } finally { release() } })())
  }

  /**
   * Read the candidate models captured by this member's Lead.
   * @param caller - Exact live Team member.
   * @returns Its Lead's configured candidate models.
   */
  modelSelection(caller: Agent): TeamModelSelection | null { return this.models.selection(this.roster.membership(caller).root) }

  /**
   * Stop the Team or one responsibility, retaining the roster and shared tasks.
   * @param caller - Exact live Lead.
   * @param target - Teammate name; omission stops the whole Team.
   * @returns After selected executions and pending creation have settled.
   */
  async stop(caller: Agent, target?: string): Promise<void> {
    const membership = this.roster.membership(caller)
    if (membership.role !== 'lead') throw new TeamError('only the Team Lead can stop collaboration', 'TEAM_LEAD_REQUIRED')
    if (target !== undefined) {
      if (!this.listMembers(caller).some(member => member.name === target && member.role !== 'lead')) throw new TeamError('Unknown teammate to stop', 'TEAM_INVALID_TARGET')
      this.models.markStopped(caller, target)
      this.roster.interrupt(caller, target)
      const member = this.listMembers(caller).find(member => member.name === target)
      if (member !== undefined) await this.ctx.agents.get(member.id)?.whenIdle()
      return
    }
    const prior = this.stopping.get(caller)
    if (prior !== undefined) return prior
    this.models.markStopped(caller)
    const operation = (async () => {
      caller.cancel({ kind: 'user' })
      await Promise.allSettled(this.lifecycle.pending())
      await this.roster.stopTeammates(caller, this.listMembers(caller).filter(member => member.role !== 'lead').map(member => member.id))
      await caller.whenIdle()
    })()
    this.stopping.set(caller, operation)
    try { await operation } finally { this.stopping.delete(caller) }
  }

  /**
   * Deliver direct human input to responsibilities or configured model aliases.
   * @param caller - Live Lead conversation.
   * @param targets - Member names or candidate model aliases.
   * @param content - Complete accepted human input.
   * @param provider - Continuable execution provider for a newly addressed model.
   * @param signal - Caller-owned admission cancellation.
   * @returns After every selected target has accepted its input; partial failures reject visibly.
   */
  async tell(caller: Agent, targets: readonly string[], content: import('@deepseek-ai/dsh-llm').ContentBlock[], provider: string, signal: AbortSignal): Promise<void> {
    if (this.roster.membership(caller).role !== 'lead') throw new TeamError('direct Team messages require the Lead conversation', 'TEAM_LEAD_REQUIRED')
    const selection = this.models.selection(caller)
    targets = [...new Set(targets.map(target => target === selection?.leader ? 'lead' : target))]
    for (const target of targets) {
      if (!this.listMembers(caller).some(member => member.name === target)
        && !selection?.models.some(model => model.name === target)) throw new TeamError(`Unknown Team member or model: ${target}`, 'TEAM_INVALID_TARGET')
    }
    this.models.reopen(caller)
    const text = content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    if (targets.length === 1 && targets[0] === 'lead') {
      caller.steer(createUserMessage({ content, source: { kind: 'user' } }))
      return
    }
    caller.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: `${targets.map(target => `@${target}`).join(' ')} ${text}` }, ...content.filter(block => block.type !== 'text')], source: { kind: 'user' } }), { surfaceOp: 'append' })
    await this.ctx.sessions.flush(caller.session)
    const results = await Promise.allSettled(targets.map(async (target) => {
      const existing = this.listMembers(caller).find(member => member.name === target)
      if (existing !== undefined) {
        if (existing.role === 'lead') { caller.steer(createUserMessage({ content, source: { kind: 'user' } })); return }
        this.models.assertAdmission(caller, target)
        const child = this.ctx.agents.get(existing.id)
        if (child === undefined) throw new TeamError('The teammate is unavailable; start a new responsibility', 'TEAM_INVALID_TARGET')
        await steerHostSubagentPrompt(this.ctx.subagents, caller, existing.id, content, { kind: 'user' }, signal)
        return
      }
      const model = selection?.models.find(model => model.name === target)
      if (model === undefined) throw new TeamError('The selected model is unavailable', 'TEAM_INVALID_TARGET')
      await this.spawnTeammate(caller, { name: target, description: model.strengths, prompt: content, context: 'fresh', provider, model: target, signal })
    }))
    const failures = results.flatMap((result, index) => result.status === 'rejected' ? [`${targets[index]}: ${errorMessage(result.reason)}`] : [])
    if (failures.length > 0) throw new TeamError(`Some Team messages failed or were unconfirmed: ${failures.join('; ')}. Inspect the affected members before retrying.`, 'TEAM_PARTIAL_DELIVERY')
  }

  /**
   * Steer one peer message into the target inbox or reject the attempt.
   * @param caller - exact live sending Team member.
   * @param request - target name, content, and cancellation before acceptance.
   * @returns accepted inbox identity; acceptance follows normal Agent persistence and does not await model processing.
   */
  async sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult> {
    if (this.lifecycle.disposed) throw new TeamError('Agent Teams service is disposing', 'TEAM_DISPOSED')
    const membership = this.roster.membership(caller)
    this.models.assertAdmission(membership.root, request.target)
    return await this.lifecycle.track(this.sendAdmitted(caller, {
      ...request,
      signal: AbortSignal.any([request.signal, this.lifecycle.signal]),
    }))
  }

  /**
   * Create one unowned pending task in the Team Lead log.
   * @param caller - exact live Team member creating the task.
   * @param request - task text, blockers, and advisory write scopes.
   * @returns the revision-one task view.
   */
  async createTask(caller: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView> {
    return await this.tasks.create(this.roster.membership(caller), request)
  }

  /**
   * Return one task, including a deleted tombstone.
   * @param caller - exact live Team member reading the task.
   * @param id - Team-local task identity.
   * @returns the latest task value and derived readiness diagnostics.
   */
  getTask(caller: Agent, id: TeamTaskId): TeamTaskView {
    return this.tasks.get(this.roster.membership(caller), id)
  }

  /**
   * List current non-deleted tasks in numeric creation order.
   * @param caller - exact live Team member reading the board.
   * @returns detached current task views.
   */
  listTasks(caller: Agent): TeamTaskView[] {
    return this.tasks.list(this.roster.membership(caller))
  }

  /**
   * Compare-and-set one authorized task transition.
   * @param caller - exact live Team member authorizing the mutation.
   * @param request - task identity, expected revision, action, and action fields.
   * @returns the committed next task revision.
   */
  async updateTask(caller: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView> {
    return await this.tasks.update(caller, this.roster.membership(caller), request)
  }

  /**
   * Wait for the next Team-domain or member-status change.
   * @param caller - exact live Team member waiting for activity.
   * @param timeoutMs - bounded wait duration from ten seconds through one hour.
   * @param signal - caller cancellation for the wait only.
   * @returns one observed change or a timeout result.
   */
  async waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult> {
    const membership = this.roster.membership(caller)
    return await this.activity.wait(membership.id, timeoutMs, signal)
  }

  /**
   * Interrupt one live teammate turn without clearing its pending inbox.
   * @param caller - exact live Lead Agent.
   * @param targetName - durable teammate name.
   * @returns the target status sampled before cancellation.
   */
  interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'inactive' } {
    return this.roster.interrupt(caller, targetName)
  }

  /**
   * Resolve a caller without throwing, used by scoped-tool installation and observers.
   * @param agent - candidate exact live Agent.
   * @returns Team membership, or undefined for non-Team subagents and stale identities.
   */
  tryMembership(agent: Agent): TeamMembership | undefined {
    return this.roster.tryMembership(agent)
  }

  /** Deliver an admitted send using the Lead's authority and the actual sender's identity. */
  private async sendAdmitted(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult> {
    const membership = this.roster.membership(caller)
    request.signal.throwIfAborted()
    const { root } = membership
    const target = resolveActiveMember(root, this.journal.state(root), request.target)
    if (target.id === caller.id) throw new TeamError('a Team member cannot message itself', 'TEAM_SELF_MESSAGE')
    const content = [
      { type: 'text' as const, text: `Team message from ${membership.name}:` },
      ...structuredClone(request.content),
    ]
    if (Buffer.byteLength(JSON.stringify(content), 'utf8') > this.config.maxMessageBytes) {
      throw new TeamError(`team message exceeds ${this.config.maxMessageBytes} bytes`, 'TEAM_MESSAGE_TOO_LARGE')
    }
    const source = { kind: 'agent-message' as const, form: 'relay' as const, senderSessionId: caller.id }
    let messageId
    if (target.id === root.id) {
      const input = createUserMessage({ content, source })
      root.steer(input)
      messageId = input.id
    } else {
      messageId = await steerHostSubagentPrompt(this.ctx.subagents, root, target.id, content, source, request.signal)
    }
    this.activity.notify(membership.id)
    return { messageId }
  }

  /** Queue one contained provisioning reconciliation after publication has unwound. */
  private scheduleRecovery(agent: Agent): void {
    queueMicrotask(() => {
      if (this.lifecycle.disposed) return
      void this.roster.recoverFor(agent, this.lifecycle.signal).catch((error: unknown) => {
        if (this.lifecycle.disposed) return
        this.ctx.logger.warn(`Agent Teams recovery for "${agent.id}" failed: ${errorMessage(error)}`)
      })
    })
  }

  /** Stop Team-owned live branches and release every waiter before service disposal completes. */
  private async disposeRuntime(): Promise<void> {
    this.lifecycle.close()
    this.activity.close()

    const failures: unknown[] = []
    await this.lifecycle.settle(this.lifecycle.pending(), failures)
    for (const [root, childIds] of this.roster.liveChildrenByRoot()) {
      try {
        await this.roster.stopTeammates(root, childIds)
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Agent Teams runtime disposal failed')
  }
}

export default TeamService
