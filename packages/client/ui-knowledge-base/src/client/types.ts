/** Generated Remote aliases and feature-owned UI intent. */

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { KnowledgeUiKey } from './locales.ts'

export type {} from '@deepseek-ai/dsh-knowledge-base/remote'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Knowledge document management and source graph copy. */
    knowledgeBase: KnowledgeUiKey
  }
  interface ResourceProtocolMap {
    /** A bounded project or global document page and source graph. */
    'knowledge-dashboard': Dashboard
    /** One exact imported source passage. */
    'knowledge-passage': Passage
  }
}

/** The generated knowledge management Remote face. */
export type KnowledgeApi = TypertClientRemote['knowledge']
/** Dashboard values come from the Host's generated method result. */
export type DashboardResult = Extract<Awaited<ReturnType<KnowledgeApi['dashboard']>>, { ok: true }>['value']
/** Passage values come from the Host's generated method result. */
export type Passage = Extract<Awaited<ReturnType<KnowledgeApi['read']>>, { ok: true }>['value']
/** Workspace metadata used to retain the owner of every global result. */
export type KnowledgeWorkspace = ReturnType<IWorkspaces['list']['getSnapshot']>['items'][number]
/** A document's project remains explicit even when several projects share a filename. */
export type ScopedDocument = Document & { readonly workspaceId: WorkspaceId; readonly workspaceTitle: string }
/** A bounded project or global page, with source ownership attached to every result. */
export type Dashboard = Omit<DashboardResult, 'documents' | 'nodes' | 'passages'> & {
  readonly documents: ScopedDocument[]
  readonly nodes: GraphNode[]
  readonly passages: (Passage & { readonly workspaceId: WorkspaceId })[]
}
/** One management header in the current dashboard. */
export type Document = DashboardResult['documents'][number]
/** One source-derived graph node. */
export type GraphNode = DashboardResult['nodes'][number] & { readonly workspaceId: WorkspaceId | null }
/** One source-derived graph association. */
export type GraphEdge = DashboardResult['edges'][number]
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
  readonly selectWorkspace: (workspaceId: WorkspaceId | null) => void
  readonly search: (query: string) => void
  readonly page: (offset: number) => void
  readonly refresh: () => void
  readonly upload: (workspaceId: WorkspaceId, name: string, base64: string, replace: boolean) => Promise<'done' | 'exists' | 'failed'>
  readonly remove: (workspaceId: WorkspaceId, document: Document) => Promise<boolean>
  readonly report: (text: string) => void
}
