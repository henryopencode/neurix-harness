/** The canvas joins the existing Conversation and right-sidebar extension positions. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { WorkflowSnapshot } from './canvas-contract.ts'
import { CANVAS_NS, zh, en, ja, es, fr, de, ru, pt, type CanvasKey } from './canvas-locales.ts'
import { EMPTY_WORKFLOW, workflowCanvasView } from './canvas-snapshot.ts'
import { createWorkflowCanvasStore } from './canvas-store.ts'
import { createPlanDefinition } from './plan-definition.ts'
import { workflowCanvasRunDefinition } from './workflow-definition.ts'
import { WorkflowPlanPreview, WorkflowView, type WorkflowViewInjected } from './WorkflowView.tsx'
import { WorkflowTaskDetails, WorkflowTaskTitle, type WorkflowDetailsInjected } from './WorkflowTaskDetails.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Task plan canvas and task inspector copy. */
    workflowCanvas: CanvasKey
  }
}

const DETAILS_ID = '@deepseek-ai/dsh-client-ui-workflow-run/task'

function applyCanvas(ctx: Context): void {
  const sources = new WeakMap<SessionBinding, ObservableSnapshot<WorkflowSnapshot>>()
  const sourceFor = (sessionId: SessionId): ObservableSnapshot<WorkflowSnapshot> => {
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`workflow canvas: Session ${sessionId} is unavailable`)
    let source = sources.get(binding)
    if (source === undefined) {
      const target = ctx.uiConversation.binding(binding).target('workflow')
      source = { getSnapshot: () => target.getSnapshot() ?? EMPTY_WORKFLOW, subscribe: listener => target.subscribe(listener) }
      sources.set(binding, source)
    }
    return source
  }
  const openTask = (graphId: string, taskId: string): void => {
    ctx.sidebarRight.openTab('workflow-node', { params: { workflowGraphId: graphId, workflowTaskId: taskId } })
  }
  ctx.effect(() => ctx.locale.register(CANVAS_NS, { zh, en, ja, es, fr, de, ru, pt }), 'workflow canvas: dictionaries')
  const t = ctx.locale.bind(CANVAS_NS)
  ctx.uiConversation.events.register(createPlanDefinition('chat'))
  ctx.uiConversation.events.register(createPlanDefinition('workflow'))
  ctx.uiConversation.events.register(workflowCanvasRunDefinition)
  ctx.uiConversation.views.register(workflowCanvasView)
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: DETAILS_ID, kind: 'workflow-node', priority: 'builtin',
    title: () => t('task.details'),
  }), 'workflow canvas: inspector type')
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'workflow', order: 5, locale: CANVAS_NS, store: createWorkflowCanvasStore(),
    label: () => t('view.title'),
    inject: (sessionId): WorkflowViewInjected => ({
      hooks: { workflow: sourceFor(sessionId) }, openTask,
      loadOlder: async () => {
        const binding = ctx.sessions.binding(sessionId)
        if (binding === undefined) throw new Error(`workflow canvas: Session ${sessionId} is unavailable`)
        await binding.session.loadOlder()
      },
    }),
  }, WorkflowView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'workflow-plan', locale: CANVAS_NS,
    inject: sessionId => ({ hooks: { workflow: sourceFor(sessionId) }, openTask }),
  }, WorkflowPlanPreview))
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: DETAILS_ID, locale: CANVAS_NS,
    inject: (sessionId): WorkflowDetailsInjected => ({
      hooks: { workflow: sourceFor(sessionId) },
      openSession: (target) => { ctx.uiWorkspace.openSession(target) },
      openArtifact: (path) => { ctx.sidebarRight.openResource(fileAddressFor(sessionId, undefined, path)) },
    }),
  }, WorkflowTaskDetails))
  ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title', key: DETAILS_ID, locale: CANVAS_NS,
    inject: sessionId => ({ hooks: { workflow: sourceFor(sessionId) } }),
  }, WorkflowTaskTitle))
}

/** Canvas activation requires the sidebar; existing run disclosures remain independently available. */
export const workflowCanvasEntry = {
  name: 'workflow-canvas',
  inject: ['uiConversation', 'uiWorkspace', 'slots', 'sessions', 'locale', 'sidebarRight', 'sidebarRightTabs'],
  apply: applyCanvas,
}
