/** Literal keyword co-occurrence from bounded source samples; no generated facts or synthetic edges. */

import { createHash } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { KnowledgeDocument, KnowledgeDocumentId, KnowledgeGraphEdge, KnowledgeGraphNode, KnowledgeGraphNodeId } from './types.ts'

const STOP_WORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'are', 'was', 'will', 'your', 'you', 'can', 'has', 'have',
  '一个', '这个', '那个', '这些', '那些', '我们', '你们', '他们', '可以', '已经', '如果', '以及', '或者', '进行', '通过',
  '使用', '需要', '当前', '默认', '支持', '所有', '其他', '只有', '不会', '没有', '不能',
])

/**
 * Build only observed document-to-keyword associations, ranked by cross-document support.
 * @param documents - Headers visible in this bounded management page.
 * @param samples - Leading committed passage text keyed by document identity.
 * @param keywordLimit - Maximum distinct keyword nodes.
 * @param perDocument - Maximum associations for one document.
 * @returns Graph nodes and edges whose labels occur in their source documents.
 */
export function buildKnowledgeGraph(
  documents: readonly KnowledgeDocument[], samples: ReadonlyMap<KnowledgeDocumentId, string>, keywordLimit: number, perDocument: number,
): { nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[] } {
  const segmenter = new Intl.Segmenter('und', { granularity: 'word' })
  const words = new Map<KnowledgeDocumentId, Map<string, number>>()
  for (const document of documents) {
    const counts = new Map<string, number>()
    for (const part of segmenter.segment(samples.get(document.documentId) ?? '')) {
      const word = part.segment.normalize('NFC').toLowerCase()
      if (!part.isWordLike || word.length < 2 || !/\p{L}/u.test(word) || STOP_WORDS.has(word)) continue
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
    words.set(document.documentId, counts)
  }
  const totals = new Map<string, { documents: number; occurrences: number }>()
  for (const counts of words.values()) {
    for (const [word, count] of counts) {
      const value = totals.get(word) ?? { documents: 0, occurrences: 0 }
      value.documents++
      value.occurrences += count
      totals.set(word, value)
    }
  }
  const ordered = [...totals].sort(([a, left], [b, right]) =>
    right.documents - left.documents || right.occurrences - left.occurrences || (a < b ? -1 : a > b ? 1 : 0))
  const keywords = new Map(ordered.slice(0, keywordLimit).map(([label, value]) => [label, {
    id: brandString<KnowledgeGraphNodeId>('keyword:' + createHash('sha256').update(label).digest('hex')), value,
  }]))
  const nodes: KnowledgeGraphNode[] = documents.map(document => ({
    id: brandString<KnowledgeGraphNodeId>(`document:${document.documentId}`), kind: 'document', label: document.title,
    documentId: document.documentId,
  }))
  const edges: KnowledgeGraphEdge[] = []
  const retained = new Set<string>()
  for (const document of documents) {
    const counts = words.get(document.documentId)
    const candidates = ordered.filter(([word]) => keywords.has(word) && counts?.has(word)).slice(0, perDocument)
    for (const [word] of candidates) {
      const keyword = keywords.get(word)
      if (keyword === undefined) continue
      retained.add(word)
      edges.push({
        source: brandString<KnowledgeGraphNodeId>(`document:${document.documentId}`),
        target: keyword.id, occurrences: counts?.get(word) ?? 0,
      })
    }
  }
  for (const [label, keyword] of keywords) {
    if (retained.has(label)) nodes.push({
      id: keyword.id, kind: 'keyword', label, documentId: null,
    })
  }
  return { nodes, edges }
}
