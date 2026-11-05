/** Loader defaults and cross-field validation for local document indexing. */

import { isAbsolute } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { KnowledgeConfig } from './types.ts'

/** Deployment policy; embedding is opt-in and uses the named Ollama server. */
export interface Config {
  /** Absolute local directory owned by this knowledge index. */
  path: string
  /** Maximum characters per passage; defaults to 1200. */
  chunkSize?: number
  /** Maximum bytes read from one source; defaults to 20 MiB. */
  maxFileBytes?: number
  /** Maximum decoded characters per document; defaults to 2000000. */
  maxDocumentChars?: number
  /** Maximum passages in one document; defaults to 5000. */
  maxChunks?: number
  /** Maximum passages returned by search; defaults to 8. */
  maxResults?: number
  /** Maximum UTF-8 bytes in a complete tool result; defaults to 32768. */
  maxResultBytes?: number
  /** Maximum documents in one management page and its graph; defaults to 30. */
  graphDocuments?: number
  /** Maximum keyword nodes shared by a graph; defaults to 24. */
  graphKeywords?: number
  /** Maximum keyword associations retained per document; defaults to 5. */
  graphKeywordsPerDocument?: number
  /** Maximum leading passages sampled from one document for graph keywords; defaults to 8. */
  graphChunksPerDocument?: number
  /** Maximum UTF-8 bytes in a complete management snapshot; defaults to 262144. */
  maxDashboardBytes?: number
  /** Explicit embedding server and model; omit for local keyword retrieval. */
  embedding?: {
    /** Ollama HTTP endpoint; document passages are sent to this configured server. */
    baseUrl: string
    /** Explicit embedding model already installed on the selected Ollama server. */
    model: string
  } | null
}

/** Schemastery schema for explicit per-deployment limits and embedding selection. */
export const Config: z<Config> = z.object({
  path: z.string().min(1).required(),
  chunkSize: z.number().step(1).min(64).default(1200),
  maxFileBytes: z.number().step(1).min(1).default(20 * 1024 * 1024),
  maxDocumentChars: z.number().step(1).min(1).default(2_000_000),
  maxChunks: z.number().step(1).min(1).default(5000),
  maxResults: z.number().step(1).min(1).default(8),
  maxResultBytes: z.number().step(1).min(256).default(32768),
  graphDocuments: z.number().step(1).min(1).default(30),
  graphKeywords: z.number().step(1).min(1).default(24),
  graphKeywordsPerDocument: z.number().step(1).min(1).default(5),
  graphChunksPerDocument: z.number().step(1).min(1).default(8),
  maxDashboardBytes: z.number().step(1).min(256).default(262144),
  embedding: z.union([
    z.const(null), z.object({ baseUrl: z.string().min(1).required(), model: z.string().min(1).required() }),
  ]).default(null),
})

/**
 * Resolve Loader defaults and reject invalid indexing budgets before opening files.
 * @param config - Deployment input.
 * @returns Fully resolved limits and an optional explicit embedding target.
 */
export function resolveConfig(config: Config): KnowledgeConfig {
  const resolved = Config(config) as Required<Config>
  if (!isAbsolute(resolved.path)) throw new Error('knowledge-base: path must be absolute')
  const chunkSize = resolved.chunkSize
  const embedding = resolved.embedding ?? undefined
  if (embedding !== undefined) {
    const url = new URL(embedding.baseUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('knowledge-base: embedding.baseUrl must be an HTTP(S) URL without credentials, query, or fragment')
    }
  }
  return {
    path: resolved.path, chunkSize,
    maxFileBytes: resolved.maxFileBytes, maxDocumentChars: resolved.maxDocumentChars,
    maxChunks: resolved.maxChunks, maxResults: resolved.maxResults, maxResultBytes: resolved.maxResultBytes,
    graphDocuments: resolved.graphDocuments, graphKeywords: resolved.graphKeywords,
    graphKeywordsPerDocument: resolved.graphKeywordsPerDocument, graphChunksPerDocument: resolved.graphChunksPerDocument,
    maxDashboardBytes: resolved.maxDashboardBytes,
    ...(embedding === undefined ? {} : { embedding }),
  }
}
