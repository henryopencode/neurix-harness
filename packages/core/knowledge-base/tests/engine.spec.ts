import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { KnowledgeIndex } from '../src/engine.ts'
import { resolveConfig, type Config } from '../src/config.ts'
import { extractSource, splitSource } from '../src/sources.ts'
import type { KnowledgeSpace } from '../src/types.ts'

const signal = new AbortController().signal
const first = brandString<KnowledgeSpace>('workspace-a')
const second = brandString<KnowledgeSpace>('workspace-b')
const indices: KnowledgeIndex[] = []
const roots: string[] = []
const bytes = (text: string) => new TextEncoder().encode(text)

function importBytes(index: KnowledgeIndex, space: KnowledgeSpace, source: string, content: Uint8Array, abort: AbortSignal) {
  return index.import(space, async () => ({ source, bytes: content }), abort)
}

afterEach(async () => {
  await Promise.all(indices.splice(0).map(index => index.close()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(overrides: Partial<Config> = {}) {
  const path = await mkdtemp(join(tmpdir(), 'knowledge-index-'))
  roots.push(path)
  const config = resolveConfig({ path, ...overrides })
  const index = new KnowledgeIndex(config)
  indices.push(index)
  await index.open()
  return { index, path, config }
}

it('retrieves Chinese source text with line citations and preserves it after restart', async () => {
  const { index, config } = await fixture()
  const imported = await importBytes(index, first, '/reference/运营指南.md', bytes('# 发布规范\n视频发布前必须检查字幕和封面。\n每周复盘选题效果。'), signal)
  const result = await index.search(first, '字幕', 5, signal)
  expect(result.mode).toBe('keyword')
  expect(result.passages).toHaveLength(1)
  expect(result.passages[0]).toMatchObject({ ...imported, chunk: 0, page: null, startLine: 1, endLine: 3 })
  await index.close()
  const reopened = new KnowledgeIndex(config)
  indices.push(reopened)
  await reopened.open()
  expect(await reopened.read(first, imported.documentId, 0, imported.version, signal)).toEqual(result.passages[0])
})

it('filters workspace ownership before limiting keyword matches and exact reads', async () => {
  const { index } = await fixture()
  await importBytes(index, first, '/reference/a.md', bytes('字幕 字幕 字幕 字幕'), signal)
  const own = await importBytes(index, second, '/reference/a.md', bytes('字幕检查规则'), signal)
  expect((await index.search(second, '字幕', 1, signal)).passages).toMatchObject([{ version: own.version }])
  expect(await index.list(second, 0, 5, signal)).toMatchObject({ documents: [own], nextOffset: null })
  await expect(index.read(first, own.documentId, 0, own.version, signal)).rejects.toMatchObject({ code: 'KNOWLEDGE_NOT_FOUND' })
  await index.remove(second, own.documentId, signal)
  expect((await index.search(first, '字幕', 5, signal)).passages).toHaveLength(1)
})

it('derives bounded document graphs from the current workspace and paginates their headers', async () => {
  const { index } = await fixture({ graphDocuments: 1, graphKeywords: 2, graphKeywordsPerDocument: 2 })
  await importBytes(index, first, '/reference/a.md', bytes('字幕审核需要检查字幕。'), signal)
  await importBytes(index, first, '/reference/b.md', bytes('封面审核需要检查封面。'), signal)
  await importBytes(index, second, '/reference/private.md', bytes('绝密口令不属于当前工作区。'), signal)
  const page = await index.dashboard(first, '', 0, signal)
  expect(page).toMatchObject({ totalDocuments: 2, totalPassages: 2, nextOffset: 1, truncated: true })
  expect(page.documents).toHaveLength(1)
  expect(page.nodes.filter(node => node.kind === 'keyword').length).toBeLessThanOrEqual(2)
  expect(page.edges.length).toBeLessThanOrEqual(2)
  const text = (await index.read(first, page.documents[0]!.documentId, 0, page.documents[0]!.version, signal)).text
  for (const node of page.nodes.filter(node => node.kind === 'keyword')) {
    expect(text.toLowerCase()).toContain(node.label)
    expect(page.edges.some(edge => edge.target === node.id && edge.occurrences > 0)).toBe(true)
  }
  const next = await index.dashboard(first, '', page.nextOffset!, signal)
  expect(next.nextOffset).toBeNull()
  expect(next.documents[0]?.documentId).not.toBe(page.documents[0]?.documentId)
  const search = await index.dashboard(first, '封面', 0, signal)
  expect(search.documents.map(item => item.source)).toEqual(['/reference/b.md'])
  expect(search.passages[0]?.text).toContain('封面')
  expect(JSON.stringify(page)).not.toContain('绝密')
})

it('rejects unconfirmed replacement and oversized management snapshots without changing indexed content', async () => {
  const { index } = await fixture({ maxDashboardBytes: 256 })
  const load = async () => ({ source: '/reference/a.md', bytes: bytes('字幕审核。') })
  const original = await index.import(first, load, signal, false)
  await expect(index.import(first, load, signal, false)).rejects.toMatchObject({ code: 'KNOWLEDGE_ALREADY_EXISTS' })
  await expect(index.dashboard(first, '', 0, signal)).rejects.toMatchObject({ code: 'KNOWLEDGE_TOO_LARGE' })
  expect((await index.read(first, original.documentId, 0, original.version, signal)).text).toBe('字幕审核。')
})

it('replaces a document revision and removes its old tail without deleting another document', async () => {
  const { index } = await fixture({ chunkSize: 64 })
  const old = await importBytes(index, first, '/reference/versioned.md', bytes('旧版封面审核要求。'.repeat(30)), signal)
  expect(old.chunks).toBeGreaterThan(1)
  const other = await importBytes(index, first, '/reference/other.txt', bytes('独立文档保留。'), signal)
  const updated = await importBytes(index, first, '/reference/versioned.md', bytes('新版规定只需字幕审核。'), signal)
  expect(updated).toMatchObject({ documentId: old.documentId, chunks: 1 })
  expect(updated.version).not.toBe(old.version)
  expect((await index.search(first, '旧版', 8, signal)).passages).toEqual([])
  expect((await index.list(first, 0, 8, signal)).documents).toEqual(expect.arrayContaining([other, updated]))
  await expect(index.read(first, old.documentId, 0, old.version, signal)).rejects.toMatchObject({ code: 'KNOWLEDGE_NOT_FOUND' })
  await index.remove(first, updated.documentId, signal)
  expect((await index.list(first, 0, 8, signal)).documents).toEqual([other])
})

it('rejects unsupported, oversized, empty, and cancelled imports before replacing a valid revision', async () => {
  const { index } = await fixture({ maxFileBytes: 100, maxDocumentChars: 50, chunkSize: 64 })
  const original = await importBytes(index, first, '/reference/source.md', bytes('有效资料'), signal)
  for (const [source, content, code] of [
    ['/reference/source.md', new Uint8Array(101), 'KNOWLEDGE_TOO_LARGE'],
    ['/reference/source.md', bytes('x'.repeat(51)), 'KNOWLEDGE_TOO_LARGE'],
    ['/reference/source.zip', bytes('abc'), 'KNOWLEDGE_UNSUPPORTED'],
    ['/reference/source.md', bytes('  '), 'KNOWLEDGE_UNSUPPORTED'],
    ['/reference/source.md', new Uint8Array([0xff]), 'KNOWLEDGE_UNSUPPORTED'],
  ] as const) await expect(importBytes(index, first, source, content, signal)).rejects.toMatchObject({ code })
  await expect(importBytes(index, first, '/reference/source.md', bytes('取消替换'), AbortSignal.abort())).rejects.toBeDefined()
  expect((await index.list(first, 0, 5, signal)).documents).toEqual([original])
})

it('enforces complete UTF-8 result budgets and rejects a single oversized passage', async () => {
  const { index, config } = await fixture({ maxResultBytes: 1100 })
  for (const name of ['a', 'b', 'c']) await importBytes(index, first, `/reference/${name}.md`, bytes('字幕'.repeat(100)), signal)
  const result = await index.search(first, '字幕', 8, signal)
  expect(result.passages.length).toBeGreaterThan(0)
  expect(result.passages.length).toBeLessThan(3)
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(config.maxResultBytes)
  await importBytes(index, first, '/reference/large.md', bytes('大字'.repeat(500)), signal)
  await expect(index.search(first, '大字', 1, signal)).rejects.toMatchObject({ code: 'KNOWLEDGE_TOO_LARGE' })
})

it('paginates metadata, rejects a changed embedding identity, and releases admission on close', async () => {
  const { index, path } = await fixture()
  for (const name of ['a', 'b', 'c']) await importBytes(index, first, `/reference/${name}.md`, bytes(name), signal)
  const page = await index.list(first, 0, 1, signal)
  expect(page.documents).toHaveLength(1)
  expect(page.nextOffset).toBe(1)
  expect((await index.list(first, page.nextOffset!, 8, signal)).documents).toHaveLength(2)
  await index.close()
  await expect(index.search(first, 'a', 1, signal)).rejects.toMatchObject({ code: 'KNOWLEDGE_CLOSED' })
  const changed = new KnowledgeIndex(resolveConfig({ path, embedding: { baseUrl: 'http://127.0.0.1:11434', model: 'other-model' } }))
  await expect(changed.open()).rejects.toMatchObject({ code: 'KNOWLEDGE_FORMAT_MISMATCH' })
})

it('retains original line positions for repeated text across non-overlapping passages', async () => {
  const { config } = await fixture({ chunkSize: 64 })
  const text = Array.from({ length: 40 }, () => '重复的一行文字。').join('\n')
  const chunks = await splitSource([{ text, page: null }], config, signal)
  expect(chunks.at(-1)?.endLine).toBe(40)
  for (const chunk of chunks) expect(text.split('\n').slice(chunk.startLine! - 1, chunk.endLine!).join('\n')).toContain(chunk.text)
})

it('extracts PDF source text and retains its original page number', async () => {
  const { index, path } = await fixture()
  const stream = 'BT /F1 12 Tf 50 700 Td (Publishing checklist) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((object, i) => { const offset = pdf.length; pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; return offset })
  const xref = pdf.length
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  await writeFile(join(path, 'source.pdf'), pdf)
  const pages = await extractSource('source.pdf', bytes(pdf), 1000, signal)
  expect(pages[0]).toMatchObject({ page: 1 })
  expect(pages[0]?.text).toContain('Publishing checklist')
  const imported = await importBytes(index, first, '/reference/source.pdf', bytes(pdf), signal)
  expect((await index.read(first, imported.documentId, 0, imported.version, signal)).page).toBe(1)
})
