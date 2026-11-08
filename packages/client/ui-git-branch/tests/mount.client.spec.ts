/** The header resource leaves before its generated Remote namespace, and can be mounted again. */
import { Context, Service } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import * as Resources from '@deepseek-ai/dsh-client-resources/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { expect, it, onTestFinished } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

it('withdraws UI and resources before Remote methods and supports plugin reload', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry).await()
  await ctx.plugin(Resources).await()
  ctx.slots.register({ name: 'root', children: {
    'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
  } }, ({ renderSlot }: PropsRenderSlots<'conversation.session.header.utilities'>) => { void renderSlot; return null })
  const address = 'dsh-resource://git-branch/session'
  let removals = 0
  const namespace = { follow: () => { throw new Error('No rendered resource in this lifecycle fixture') } }
  class Remote extends Service {
    constructor() { super(ctx, 'remote') }
    async $mount(contribution: TypertRemoteContribution) {
      expect(contribution.package).toBe('@deepseek-ai/dsh-client-ui-git-branch')
      const release = ctx.reflect.provide('remote.gitBranch', namespace)
      return async () => {
        expect(ctx.slots.entries('conversation.session.header.utilities')).toHaveLength(0)
        expect(ctx.resources.source(address).getSnapshot().status).toBe('none')
        removals += 1
        await release()
      }
    }
  }
  new Remote()
  for (let round = 0; round < 2; round += 1) {
    const plugin = ctx.plugin({ inject, apply })
    await plugin.await()
    expect(ctx.slots.entries('conversation.session.header.utilities').map(entry => entry.options.id)).toEqual(['git-branch'])
    expect(ctx.resources.source(address).getSnapshot().status).toBe('loading')
    await plugin.dispose()
  }
  expect(removals).toBe(2)
})
