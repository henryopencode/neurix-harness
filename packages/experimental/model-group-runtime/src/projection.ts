/**
 * Model-group configuration recovery without retaining message history.
 * @module
 */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { ModelGroupSnapshot } from './types.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { memberSchema } from './schema.ts'

const snapshotSchema: z.ZodType<ModelGroupSnapshot> = z.object({
  mode: z.enum(['single', 'multi']), leader: z.string(), members: z.array(memberSchema),
  stopped: z.boolean(), direct: z.array(z.string()), stoppedMembers: z.array(z.string()).default([]),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.members.map(member => member.name)).size !== value.members.length) {
    ctx.addIssue({ code: 'custom', message: 'Model group member names must be unique' })
  }
  if (value.members.length > 0 && !value.members.some(member => member.name === value.leader)) {
    ctx.addIssue({ code: 'custom', message: 'The leader must be a group member' })
  }
})

/** Private recovery state; usage freezes member defaults after accepted conversation activity. */
export interface ModelGroupProjectionState {
  /** Latest recorded selection, or null before group initialization. */
  readonly group: ModelGroupSnapshot | null
  /** Accepted input or execution freezes this conversation's member selection. */
  readonly used: boolean
}

function applyGroup(state: ModelGroupSnapshot | null, event: SessionEvent): ModelGroupSnapshot | null {
  if (event.type === 'model-group/configured') return snapshotSchema.parse(event.data)
  if (state === null) return state
  if (event.type === 'model-group/member-stopped') {
    const { member } = z.object({ member: z.string() }).strict().parse(event.data)
    if (state.stoppedMembers.includes(member)) return state
    return { ...state, stoppedMembers: [...state.stoppedMembers, member] }
  }
  if (event.type === 'model-group/stopped') {
    const { stopped } = z.object({ stopped: z.boolean() }).strict().parse(event.data)
    return stopped === state.stopped ? state : { ...state, stopped }
  }
  if (event.type === 'model-group/delivery') {
    const { member, direct } = z.object({ member: z.string(), direct: z.boolean() }).strict().parse(event.data)
    if (!state.members.some(candidate => candidate.name === member)) throw new Error('Unknown model-group delivery member')
    const names = state.direct.filter(name => name !== member)
    return { ...state, direct: direct ? [...names, member] : names }
  }
  return state
}

/** Configuration and first-use recovery; message history remains in the paged Session log. */
export const modelGroupProjection = {
  key: 'modelGroup', stateVersion: 2,
  stateSchema: z.object({ group: snapshotSchema.nullable(), used: z.boolean() }).strict(),
  init: (): ModelGroupProjectionState => ({ group: null, used: false }),
  apply: (state, event) => {
    const group = applyGroup(state.group, event)
    const used = state.used || event.type === 'turn/start'
      || (event.type === 'user/message' && event.data.source.kind === 'user')
      || event.type === 'model-group/post'
      || event.type === 'model-group/dispatched' || event.type === 'model-group/delivery'
    return group === state.group && used === state.used ? state : { group, used }
  },
  wire: { viewSchema: snapshotSchema.nullable(), view: state => state.group },
} satisfies ProjectionDefinition<'modelGroup', ModelGroupProjectionState>
