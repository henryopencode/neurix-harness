/** Bounded PDF/text extraction and LangChain passage splitting with source locations. */

import { extname } from 'node:path'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { KnowledgeError } from './errors.ts'
import type { KnowledgeConfig, SourcePassage, SourceText } from './types.ts'

/**
 * Decode a supported source without executing embedded document content.
 * @param source - Source filename used only to select its decoder.
 * @param bytes - Complete size-bounded source bytes.
 * @param maxChars - Maximum extracted characters across all pages.
 * @param signal - Cancellation checked between PDF pages.
 * @returns Text with 1-based PDF page numbers, or null pages for UTF-8 files.
 */
export async function extractSource(source: string, bytes: Uint8Array, maxChars: number, signal: AbortSignal): Promise<SourceText[]> {
  signal.throwIfAborted()
  const extension = extname(source).toLowerCase()
  let pages: SourceText[]
  if (extension === '.pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
    try {
      const document = await loading.promise
      pages = []
      let chars = 0
      for (let page = 1; page <= document.numPages; page++) {
        signal.throwIfAborted()
        const content = await (await document.getPage(page)).getTextContent()
        const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('')
        chars += text.length
        if (chars > maxChars) throw new KnowledgeError('Document text exceeds the configured character limit.', 'KNOWLEDGE_TOO_LARGE')
        pages.push({ text, page })
      }
    } finally {
      await loading.destroy()
    }
  } else if (['.txt', '.md', '.markdown'].includes(extension)) {
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch (error) {
      throw new KnowledgeError('Import requires a UTF-8 text file.', 'KNOWLEDGE_UNSUPPORTED', { cause: error })
    }
    if (text.includes('\0')) throw new KnowledgeError('Binary content cannot be imported as text.', 'KNOWLEDGE_UNSUPPORTED')
    if (text.length > maxChars) throw new KnowledgeError('Document text exceeds the configured character limit.', 'KNOWLEDGE_TOO_LARGE')
    pages = [{ text, page: null }]
  } else {
    throw new KnowledgeError('Supported sources are Markdown, UTF-8 TXT, and text PDFs.', 'KNOWLEDGE_UNSUPPORTED')
  }
  if (!pages.some(page => page.text.trim())) {
    throw new KnowledgeError('No text was extracted. Scanned PDFs require OCR before import.', 'KNOWLEDGE_UNSUPPORTED')
  }
  signal.throwIfAborted()
  return pages
}

/**
 * Split source pages while retaining page numbers or exact original line ranges.
 * @param pages - Bounded extracted text.
 * @param config - Resolved passage size and count budgets.
 * @param signal - Cancellation checked between pages and passages.
 * @returns Ordered source passages; rejects before any index write when a budget is exceeded.
 */
export async function splitSource(
  pages: SourceText[], config: KnowledgeConfig, signal: AbortSignal,
): Promise<SourcePassage[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: config.chunkSize, chunkOverlap: 0,
    separators: ['\n\n', '\n', '。', '！', '？', '；', ' ', ''],
  })
  const passages: SourcePassage[] = []
  for (const page of pages) {
    signal.throwIfAborted()
    let previous = 0
    let startLine = 1
    let searchFrom = 0
    for (const text of await splitter.splitText(page.text)) {
      signal.throwIfAborted()
      const start = page.text.indexOf(text, searchFrom)
      if (start < 0) throw new Error('knowledge-base: split passage is absent from its source')
      startLine += (page.text.slice(previous, start).match(/\n/gu) ?? []).length
      const endLine = startLine + (text.match(/\n/gu) ?? []).length
      passages.push({
        text, page: page.page, startLine: page.page === null ? startLine : null, endLine: page.page === null ? endLine : null,
      })
      previous = start
      searchFrom = start + text.length
      if (passages.length > config.maxChunks) throw new KnowledgeError('Document has too many passages; split it into smaller files.', 'KNOWLEDGE_TOO_LARGE')
    }
  }
  return passages
}
