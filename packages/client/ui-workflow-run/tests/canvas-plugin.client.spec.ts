// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { TestSessions, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkflowViewInjected } from '../src/client/WorkflowView.tsx'
import type { WorkflowDetailsInjected } from '../src/client/WorkflowTaskDetails.tsx'
import { SidebarRightTabRegistry } from '../../ui-sidebar-right/src/client/tab-registry.ts'
import { workflowCanvasEntry } from '../src/client/canvas-plugin.ts'

function Root() { return null }

describe('canvas registration lifecycle', () => {
  it('shares one Session source across entries, routes existing navigation, and retracts every contribution', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
    const sessions = new TestSessions(async (action) => { await action() }, ctx)
    ctx.provide('sessions', sessions)
    const openSession = vi.fn()
    const openTab = vi.fn()
    const openResource = vi.fn()
    ctx.provide('uiWorkspace', { openSession } as never)
    ctx.provide('sidebarRight', { openTab, openResource } as never)
    const tabs = new SidebarRightTabRegistry(ctx)
    ctx.provide('sidebarRightTabs', tabs)
    const conversation = new UiConversation(ctx, ctx.sessions)
    ctx.slots.register({ name: 'root', children: {
      'conversation.view': { kind: 'list', scope: 'session' },
      'conversation.chat.node': { kind: 'keyed', scope: 'session' },
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
      'sidebar.right.pane.tab.title': { kind: 'keyed', scope: 'session' },
    } } as never, Root)
    await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
    const id = 'canvas-plugin-session' as SessionId
    const loadOlder = vi.fn(async () => {})
    await sessions.add({ id, session: { loadOlder } })
    const reference = sessions.retain(id)
    await reference.ready
    onTestFinished(() => { reference.release() })
    const fiber = ctx.plugin(workflowCanvasEntry)
    await fiber.await()
    expect(conversation.events.entries()).toHaveLength(4)
    expect(conversation.views.entries().map(view => view.target)).toContain('workflow')
    const entry = ctx.slots.entries('conversation.view')[0]!
    expect(entry.options.order).toBe(15)
    expect(typeof entry.options.label === 'function' ? entry.options.label() : entry.options.label).toBeTruthy()
    const face = entry.inject?.(id as never, {} as never) as WorkflowViewInjected & Record<string, unknown>
    expect(face.hooks.workflow.getSnapshot()).toEqual({ graphs: [], executions: {} })
    const unsubscribe = face.hooks.workflow.subscribe(() => {})
    expect(face.hooks.workflow.getSnapshot()).toEqual({ graphs: [], executions: {} })
    unsubscribe()
    const repeated = entry.inject?.(id as never, {} as never) as WorkflowViewInjected & Record<string, unknown>
    expect(repeated.hooks.workflow).toBe(face.hooks.workflow)
    face.openTask('turn:1', 'task')
    expect(openTab).toHaveBeenCalledWith('workflow-node', { params: { workflowGraphId: 'turn:1', workflowTaskId: 'task' } })
    await face.loadOlder()
    expect(loadOlder).toHaveBeenCalledOnce()
    const details = ctx.slots.entries('sidebar.right.pane.tab')[0]!.inject?.(id as never) as WorkflowDetailsInjected & Record<string, unknown>
    expect(details.hooks.workflow).toBe(face.hooks.workflow)
    details.openArtifact('report.md')
    expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/canvas-plugin-session/report.md')
    details.openSession(id)
    expect(openSession).toHaveBeenCalledWith(id)
    const preview = ctx.slots.entries('conversation.chat.node')[0]!.inject?.(id as never) as Pick<WorkflowViewInjected, 'openTask' | 'hooks'>
    expect(preview.hooks.workflow).toBe(face.hooks.workflow)
    const title = ctx.slots.entries('sidebar.right.pane.tab.title')[0]!.inject?.(id as never) as Pick<WorkflowViewInjected, 'hooks'>
    expect(title.hooks.workflow).toBe(face.hooks.workflow)
    expect(tabs.get('workflow-node')?.title('')).toBeTruthy()
    reference.release()
    await sessions.disposeScopes()
    expect(() => entry.inject?.(id as never, {} as never)).toThrow('is unavailable')
    await expect(face.loadOlder()).rejects.toThrow('is unavailable')
    await fiber.dispose()
    expect(conversation.events.entries()).toEqual([])
    expect(conversation.views.entries()).toEqual([])
    expect(ctx.slots.entries('conversation.view')).toEqual([])
    expect(ctx.slots.entries('conversation.chat.node')).toEqual([])
    expect(ctx.slots.entries('sidebar.right.pane.tab')).toEqual([])
    expect(ctx.slots.entries('sidebar.right.pane.tab.title')).toEqual([])
    expect(tabs.get('workflow-node')).toBeUndefined()
  })
})
