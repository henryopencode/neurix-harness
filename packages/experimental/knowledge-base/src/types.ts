/** Source identities and complete, workspace-scoped knowledge results. */

import type {} from '@deepseek-ai/dsh-typert-protocol'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Failure classes whose handling does not depend on display text. */
export type KnowledgeErrorCode = 'KNOWLEDGE_INVALID_INPUT' | 'KNOWLEDGE_NOT_FOUND'
  | 'KNOWLEDGE_TOO_LARGE' | 'KNOWLEDGE_UNSUPPORTED' | 'KNOWLEDGE_CLOSED'
  | 'KNOWLEDGE_FORMAT_MISMATCH' | 'KNOWLEDGE_UNAUTHORIZED' | 'KNOWLEDGE_WRITE_UNKNOWN' | 'KNOWLEDGE_ALREADY_EXISTS'


/** Original workspace identity; tools derive it from the calling Session. */
export type KnowledgeSpace = Branded<'KnowledgeSpace'>
/** Stable document identity within a workspace. */
export type KnowledgeDocumentId = Branded<'KnowledgeDocumentId'>

/** Source file and imported content revision. */
export interface KnowledgeDocument {
  readonly documentId: KnowledgeDocumentId
  readonly source: string
  readonly title: string
  readonly version: string
  readonly chunks: number
}

/** A source passage, including its import revision and original location. */
export interface KnowledgePassage extends KnowledgeDocument {
  readonly chunk: number
  readonly text: string
  readonly page: number | null
  readonly startLine: number | null
  readonly endLine: number | null
}

/** Bounded search output; scores are meaningful only within this result. */
export interface KnowledgeSearch {
  readonly mode: 'keyword' | 'hybrid'
  readonly passages: KnowledgePassage[]
}

/** Bounded document metadata page; offsets remain valid while the collection is unchanged. */
export interface KnowledgeDocumentList {
  readonly documents: KnowledgeDocument[]
  readonly nextOffset: number | null
}

/** Successful removal of indexed passages, including an already absent document. */
export interface KnowledgeRemoval {
  readonly documentId: KnowledgeDocumentId
  readonly removed: true
}

/** Opaque node identity within a document-reference graph. */
export type KnowledgeGraphNodeId = Branded<'KnowledgeGraphNodeId'>

/** One literal document or keyword in a document-reference graph. */
export interface KnowledgeGraphNode {
  readonly id: KnowledgeGraphNodeId
  readonly kind: 'document' | 'keyword'
  readonly label: string
  readonly documentId: KnowledgeDocumentId | null
}

/** An observed document-to-keyword association; it does not assert a semantic fact. */
export interface KnowledgeGraphEdge {
  readonly source: KnowledgeGraphNodeId
  readonly target: KnowledgeGraphNodeId
  readonly occurrences: number
}

/** Bounded management snapshot derived from committed document passages. */
export interface KnowledgeDashboard {
  readonly totalDocuments: number
  readonly totalPassages: number
  readonly documents: KnowledgeDocument[]
  readonly passages: KnowledgePassage[]
  readonly nodes: KnowledgeGraphNode[]
  readonly edges: KnowledgeGraphEdge[]
  readonly nextOffset: number | null
  readonly truncated: boolean
  readonly pageSize: number
  readonly maxFileBytes: number
}

/** One decoded page, or an entire text document when page is null. */
export interface SourceText {
  readonly text: string
  readonly page: number | null
}

/** Decoded passage text with a PDF page or original line range. */
export type SourcePassage = Pick<KnowledgePassage, 'text' | 'page' | 'startLine' | 'endLine'>

/** Deployment-owned indexing and response limits. */
export interface KnowledgeConfig {
  readonly path: string
  readonly chunkSize: number
  readonly maxFileBytes: number
  readonly maxDocumentChars: number
  readonly maxChunks: number
  readonly maxResults: number
  readonly maxResultBytes: number
  readonly graphDocuments: number
  readonly graphKeywords: number
  readonly graphKeywordsPerDocument: number
  readonly graphChunksPerDocument: number
  readonly maxDashboardBytes: number
  readonly embedding?: {
    readonly baseUrl: string
    readonly model: string
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Knowledge validation or indexing failed; the prior document remains available unless the outcome is unknown. */
    'knowledge/operation-failed': { readonly reason: KnowledgeErrorCode }
  }
}
