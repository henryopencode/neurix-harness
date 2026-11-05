/** Generated Remote aliases and feature-owned UI intent. */

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { KnowledgeUiKey } from './locales.ts'

export type {} from '@deepseek-ai/dsh-experimental-knowledge-base/remote'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Knowledge document management and source graph copy. */
    knowledgeBase: KnowledgeUiKey
  }
  interface ResourceProtocolMap {
    /** One authorized workspace's document page and source graph. */
    'knowledge-dashboard': Dashboard
    /** One exact imported source passage. */
    'knowledge-passage': Passage
  }
}

/** The generated knowledge management Remote face. */
export type KnowledgeApi = TypertClientRemote['knowledge']
/** Dashboard values come from the Host's generated method result. */
export type Dashboard = Extract<Awaited<ReturnType<KnowledgeApi['dashboard']>>, { ok: true }>['value']
/** Passage values come from the Host's generated method result. */
export type Passage = Extract<Awaited<ReturnType<KnowledgeApi['read']>>, { ok: true }>['value']
/** One management header in the current dashboard. */
export type Document = Dashboard['documents'][number]
/** One source-derived graph node. */
export type GraphNode = Dashboard['nodes'][number]
/** One source-derived graph association. */
export type GraphEdge = Dashboard['edges'][number]
/** Feature translation function. */
export type Translate = PropsLocale<'knowledgeBase'>['t']

/** Remount-surviving user intent and operation progress; resource values are not mirrored here. */
export interface ViewState {
  readonly workspaceId: WorkspaceId | null
  readonly query: string
  readonly offset: number
  readonly busy: 'import' | 'remove' | null
}

/** One transient outcome, rendered by a shell-owned overlay. */
export interface Notice {
  readonly sequence: number
  readonly text: string
  readonly success: boolean
}

/** Plain callbacks and reactive sources consumed by the management page. */
export interface KnowledgePageInjected {
  readonly hooks: {
    readonly view: ObservableSnapshot<ViewState>
    readonly workspaces: IWorkspaces['list']
  }
  readonly selectWorkspace: (workspaceId: WorkspaceId) => void
  readonly search: (query: string) => void
  readonly page: (offset: number) => void
  readonly refresh: () => void
  readonly upload: (workspaceId: WorkspaceId, name: string, base64: string, replace: boolean) => Promise<'done' | 'exists' | 'failed'>
  readonly remove: (workspaceId: WorkspaceId, document: Document) => Promise<boolean>
  readonly report: (text: string) => void
}
