// @vitest-environment jsdom
/** MCP navigation registrations belong to their plugin and current Remote access. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { StaticRemoteAccess, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import * as Resources from '@deepseek-ai/dsh-client-resources/client'
import * as McpPage from '../src/client/index.ts'

async function bench(allowed = true) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  new TestRemote(ctx, { mcpConfigManager: {} })
  new StaticRemoteAccess(ctx, () => allowed)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: {
    main: { kind: 'keyed', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
    'shell.overlay': { kind: 'list', scope: 'root' },
  } } as never, () => null)
  await ctx.plugin(Resources).await()
  const feature = ctx.plugin(McpPage)
  await feature.await()
  return { ctx, slots, feature }
}

it('registers one MCP sidebar entry and releases it when its plugin unloads', async () => {
  const { slots, feature } = await bench()
  expect(slots.entries('sidebar.panellist').filter(entry => entry.options.id === 'mcp')).toHaveLength(1)
  await feature.dispose()
  expect(slots.entries('sidebar.panellist').some(entry => entry.options.id === 'mcp')).toBe(false)
})

it('withholds the management page when this connection cannot list MCP servers', async () => {
  const { slots } = await bench(false)
  expect(slots.entries('sidebar.panellist').some(entry => entry.options.id === 'mcp')).toBe(false)
})
