/** Team model choices, public replies, and human stop state over the existing roster. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AgentOptions } from '@deepseek-ai/dsh-agent/types'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import { TeamError } from './error.ts'
import type { Config, SpawnTeammateRequest, TeamMemberView, TeamModelSelection } from './types.ts'

const teamModelSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/), label: z.string().min(1),
  provider: z.string().min(1), model: z.string().min(1), strengths: z.string(),
}).strict()
const selectionSchema = z.object({ leader: z.string(), models: z.array(teamModelSchema) }).strict()
const stateSchema = z.object({
  selection: selectionSchema.nullable(), used: z.boolean(), stopped: z.boolean(), stoppedMembers: z.array(z.string()),
}).strict()
type State = z.infer<typeof stateSchema>

/** Incremental recovery without retaining teammate histories in the Lead. */
export const teamModelsProjection = {
  key: 'teamModels' as const, stateVersion: 1, stateSchema,
  init: (): State => ({ selection: null, used: false, stopped: false, stoppedMembers: [] }),
  apply: (state: State, event: SessionEvent): State => {
    if (event.type === 'team/models') return { ...state, selection: selectionSchema.parse(event.data) }
    if (event.type === 'team/control') return { ...state, ...z.object({ stopped: z.boolean(), stoppedMembers: z.array(z.string()) }).strict().parse(event.data) }
    if (state.used) return state
    return event.type === 'turn/start' || event.type === 'team/member' || event.type === 'team/post'
      || (event.type === 'user/message' && event.data.source.kind === 'user')
      ? { ...state, used: true } : state
  },
  wire: { viewSchema: selectionSchema.nullable(), view: (state: State) => state.selection },
}

/** Instance-owned model policy; TeamService owns authoritative roster mutations. */
export class TeamModels {
  private handle!: ProjectionHandle<State>
  private readonly reservations = new Map<Agent, Set<string>>()

  /**
   * @param ctx - Team owner context.
   * @param config - Live deployment defaults.
   * @param members - Exact Team roster reader.
   */
  constructor(private readonly ctx: Context, private readonly config: Config,
    private readonly members: (agent: Agent) => TeamMemberView[]) {}

  /** Acquire recovery before publishing model-aware Team operations. */
  async initialize(): Promise<void> {
    this.handle = await this.ctx.sessionProjections.register(teamModelsProjection)
    this.ctx.on('agent/created', ({ agent }) => { this.refresh(agent) })
    this.ctx.on('loader/volatile-update', () => { for (const agent of this.ctx.agents.list()) this.refresh(agent) })
    this.ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
      const decision = await next()
      if (agent.session.header.origin === 'subagent' || decision.kind !== 'enter') return decision
      if (messages.some(message => message.source.kind === 'user')) this.reopen(agent)
      return this.handle.stateOf(agent.session).stopped ? { kind: 'reject' } : decision
    })
    this.ctx.on('session/event', (session, event) => {
      if (session.header.origin !== 'subagent' || event.type !== 'assistant/message') return
      const parent = session.header.parentSession === undefined ? undefined : this.ctx.agents.get(session.header.parentSession)
      if (parent === undefined) return
      const member = this.members(parent).find(member => member.id === session.id)
      if (member === undefined || member.coordinationOwner === 'model-group') return
      const text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      if (text === '') return
      const model = event.data.message.source.model
      const label = this.selection(parent)?.models.find(candidate => candidate.model === model)?.label ?? model
      parent.session.append('team/post', { member: member.name, description: member.description ?? '', model, label,
        text, sourceSession: session.id, sourceSeq: event.seq })
    })
    this.ctx.on('subagent/end', (info) => {
      if (info.stopReason === 'completed') return
      const child = this.ctx.agents.get(info.id)
      const parentId = child?.session.header.parentSession
      const parent = parentId === undefined ? undefined : this.ctx.agents.get(parentId)
      if (parent === undefined) return
      const member = this.members(parent).find(member => member.id === info.id)
      const state = this.handle.stateOf(parent.session)
      if (member === undefined || member.coordinationOwner === 'model-group'
        || state.stopped || state.stoppedMembers.includes(member.name)) return
      const model = member.model ?? ''
      const label = state.selection?.models.find(candidate => candidate.model === model)?.label ?? model
      parent.session.append('team/post', { member: member.name, description: member.description ?? '', model, label,
        text: '', sourceSession: info.id, failure: info.stopReason })
    })
    for (const agent of this.ctx.agents.list()) this.refresh(agent)
  }

  /**
   * Read captured candidates without replaying histories.
   * @param agent - Live Lead.
   * @returns Captured candidate models.
   */
  selection(agent: Agent): TeamModelSelection | null { return this.handle.stateOf(agent.session).selection }

  /**
   * Admit a later human request after a stop.
   * @param agent - Live Lead receiving human input.
   */
  reopen(agent: Agent): void {
    const state = this.handle.stateOf(agent.session)
    if (state.stopped || state.stoppedMembers.length > 0) agent.session.append('team/control', { stopped: false, stoppedMembers: [] })
  }

  /**
   * Record a human stop before dependent work is cancelled.
   * @param agent - Live Lead.
   * @param member - Omission stops the Team; a name stops that responsibility.
   */
  markStopped(agent: Agent, member?: string): void {
    const state = this.handle.stateOf(agent.session)
    agent.session.append('team/control', { stopped: member === undefined || state.stopped,
      stoppedMembers: member === undefined ? state.stoppedMembers : [...new Set([...state.stoppedMembers, member])] })
  }

  /**
   * Reject stopped or excess parallel work before admission.
   * @param agent - Lead authorizing work.
   * @param target - Teammate name receiving new work.
   */
  assertAdmission(agent: Agent, target: string): void {
    const state = this.handle.stateOf(agent.session)
    if (state.stopped || state.stoppedMembers.includes(target)) throw new TeamError('The user stopped this Team or teammate; wait for another human request', 'TEAM_STOPPED')
    const active = this.members(agent).filter(member => member.role !== 'lead' && (member.status === 'running' || member.status === 'provisioning'))
    const names = new Set([...active.map(member => member.name), ...this.reservations.get(agent) ?? []])
    const limit = this.config.maxParallel?.get()
    if (target !== 'lead' && limit !== undefined && names.size >= limit && !names.has(target)) {
      throw new TeamError('The parallel teammate limit is reached; wait for an active teammate before starting more work', 'TEAM_CAPACITY')
    }
  }

  /**
   * Reserve capacity across asynchronous model validation and roster creation.
   * @param agent - Lead admitting creation.
   * @param name - Responsibility name.
   * @returns Creation reservation disposer.
   */
  reserve(agent: Agent, name: string): () => void {
    this.assertAdmission(agent, name)
    const names = this.reservations.get(agent) ?? new Set<string>()
    names.add(name); this.reservations.set(agent, names)
    return () => { names.delete(name); if (names.size === 0) this.reservations.delete(agent) }
  }

  /**
   * Resolve an explicit candidate alias to the provider request.
   * @param agent - Lead creating the teammate.
   * @param request - Responsibility and optional selected model.
   * @returns Provider options, preserving inherited selection without a configured model list.
   */
  resolve(agent: Agent, request: SpawnTeammateRequest): AgentOptions | undefined {
    this.assertAdmission(agent, request.name)
    const selection = this.selection(agent)
    if (selection === null || selection.models.length === 0) return request.agentOptions
    const model = selection.models.find(model => model.name === request.model)
    if (model === undefined) throw new TeamError('Choose a model alias from the Team candidate list for this responsibility', 'TEAM_MODEL_REQUIRED')
    if (request.agentOptions !== undefined
      && (request.agentOptions.provider !== model.provider || request.agentOptions.model !== model.model)) {
      throw new TeamError('The explicit model route disagrees with the selected Team model', 'TEAM_MODEL_CONFLICT')
    }
    return { ...request.agentOptions, provider: model.provider, model: model.model }
  }

  private refresh(agent: Agent): void {
    if (agent.session.header.origin === 'subagent' || agent.status !== 'idle') return
    if ((this.reservations.get(agent)?.size ?? 0) > 0) return
    const state = this.handle.stateOf(agent.session)
    if (state.used && state.selection !== null) return
    const selection = selectionSchema.parse({ leader: this.config.leaderModel?.get() ?? '', models: this.config.models?.get() ?? [] })
    if (selection.models.length === 0 && state.selection === null) return
    if (new Set(selection.models.map(model => model.name)).size !== selection.models.length
      || (selection.leader !== '' && !selection.models.some(model => model.name === selection.leader))) {
      throw new TeamError('Choose unique model aliases and a Lead model from the Team candidate list', 'TEAM_INVALID_CONFIG')
    }
    if (JSON.stringify(state.selection) !== JSON.stringify(selection)) agent.session.append('team/models', selection)
    const lead = selection.models.find(model => model.name === selection.leader)
    if (lead !== undefined && !state.used) agent.model.select({ provider: lead.provider, model: lead.model })
  }
}
