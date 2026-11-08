/** Exercise persistent document memory through its standalone helper and the real skill Loader. */

import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { boot } from '@deepseek-ai/dsh-app-boot'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = resolve(import.meta.dirname, '../../..')
const skillRoot = join(repoRoot, '.agents/skills/dsh-memory-documents')
const helper = join(skillRoot, 'scripts/memory-documents.mjs')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const temporaryRoots = new Set<string>()
const contexts = new Set<Context>()

interface DocumentInput {
  id: string
  title: string
  summary: string
  tags: string[]
  body: string
  images: { source: string; caption: string }[]
  status?: 'active' | 'archived'
  expectedRevision?: string
}

interface DocumentResult {
  id: string
  title: string
  summary: string
  body: string
  revision: string
  root: string
  path: string
  status: 'active' | 'archived'
  images: { path: string; caption: string; absolutePath: string }[]
}

interface SearchResult {
  root: string
  total: number
  results: Omit<DocumentResult, 'body'>[]
}

afterEach(async () => {
  await Promise.all([...contexts].map(async ctx => ctx.fiber.dispose()))
  contexts.clear()
  await Promise.all([...temporaryRoots].map(async path => rm(path, { recursive: true, force: true })))
  temporaryRoots.clear()
})

async function workspace(): Promise<string> {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'dsh-memory-documents-')))
  temporaryRoots.add(path)
  return path
}

function topic(overrides: Partial<DocumentInput> = {}): DocumentInput {
  return {
    id: 'homepage-layout', title: '首页布局', summary: '项目首页采用三栏卡片布局。',
    tags: ['首页', 'layout'], body: '# 首页布局\n\n保持标题与内容之间的留白。', images: [], ...overrides,
  }
}

async function command(cwd: string, args: string[], input?: DocumentInput | string, script = helper) {
  return execa(process.execPath, [script, ...args], {
    cwd,
    ...(input === undefined ? {} : { input: typeof input === 'string' ? input : JSON.stringify(input) }),
    reject: false,
  })
}

async function save(root: string, input: DocumentInput): Promise<DocumentResult> {
  const result = await command(root, ['put', '--root', join(root, 'memory')], input)
  expect(result.exitCode, result.stderr).toBe(0)
  return JSON.parse(result.stdout) as DocumentResult
}

describe('project memory documents', () => {
  it('copies captioned images and recalls them from a later process after the original disappears', async () => {
    const cwd = await workspace()
    const source = join(cwd, '临时 reference')
    await writeFile(source, png)
    const created = await save(cwd, topic({ images: [{ source, caption: '琥珀色按钮位于卡片右下角。' }] }))
    await rm(source)

    const found = await command(cwd, ['search', '--root', created.root, '--query', '琥珀色'])
    expect(found.exitCode, found.stderr).toBe(0)
    const search = JSON.parse(found.stdout) as SearchResult
    expect(search.total).toBe(1)
    expect(search.results[0]).not.toHaveProperty('body')
    expect(search.results[0]?.path).toBe(created.path)
    const recalled = await command(cwd, ['get', '--root', created.root, '--id', created.id])
    expect(recalled.exitCode, recalled.stderr).toBe(0)
    const doc = JSON.parse(recalled.stdout) as DocumentResult
    expect(doc.body).toBe(topic().body)
    expect(doc.images).toHaveLength(1)
    expect(await readFile(doc.images[0]!.absolutePath)).toEqual(png)
    expect(await readFile(doc.path, 'utf8')).toContain(`![琥珀色按钮位于卡片右下角。](../${doc.images[0]!.path})`)
    expect(await readFile(join(doc.root, 'INDEX.md'), 'utf8')).toContain('[首页布局](documents/homepage-layout.md)')
  })

  it('requires the current revision and excludes archived topics from ordinary recall', async () => {
    const cwd = await workspace()
    const created = await save(cwd, topic())
    const updated = await save(cwd, topic({ body: '# 首页布局\n\n使用两栏卡片。', expectedRevision: created.revision }))
    const beforeConflict = await readFile(updated.path)
    for (const expectedRevision of [undefined, created.revision]) {
      const stale = await command(cwd, ['put', '--root', created.root], topic(expectedRevision === undefined ? {} : { expectedRevision }))
      expect(stale.exitCode).toBe(1)
      expect(JSON.parse(stale.stderr)).toMatchObject({ error: { code: 'REVISION_CONFLICT', currentRevision: updated.revision } })
      expect(await readFile(updated.path)).toEqual(beforeConflict)
    }
    await save(cwd, topic({ expectedRevision: updated.revision, status: 'archived' }))
    const hidden = await command(cwd, ['search', '--root', created.root])
    expect(JSON.parse(hidden.stdout)).toMatchObject({ total: 0, results: [] })
    const archived = await command(cwd, ['search', '--root', created.root, '--include-archived'])
    expect(JSON.parse(archived.stdout)).toMatchObject({ total: 1, results: [{ status: 'archived' }] })
  })

  it('searches authoritative Markdown after manual edits and rebuilds an obsolete index', async () => {
    const cwd = await workspace()
    const created = await save(cwd, topic())
    const edited = (await readFile(created.path, 'utf8')).replace('保持标题与内容之间的留白。', '保留铅笔纹理。')
    await writeFile(created.path, edited)
    await writeFile(join(created.root, 'INDEX.md'), 'obsolete index\n')
    const found = await command(cwd, ['search', '--root', created.root, '--query', '铅笔纹理'])
    expect(JSON.parse(found.stdout)).toMatchObject({ total: 1 })
    const rebuilt = await command(cwd, ['reindex', '--root', created.root])
    expect(rebuilt.exitCode, rebuilt.stderr).toBe(0)
    expect(await readFile(join(created.root, 'INDEX.md'), 'utf8')).toContain('项目首页采用三栏卡片布局。')
    expect(await readFile(created.path, 'utf8')).toBe(edited)
  })

  it('reports a committed document when the index fails and repairs it without another write', async () => {
    const cwd = await workspace()
    const store = join(cwd, 'memory')
    await mkdir(join(store, 'INDEX.md'), { recursive: true })
    const result = await command(cwd, ['put', '--root', store], topic())
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: 'INDEX_UPDATE_FAILED', committed: true } })
    const read = await command(cwd, ['get', '--root', store, '--id', 'homepage-layout'])
    expect(read.exitCode, read.stderr).toBe(0)
    const before = await readFile(join(store, 'documents/homepage-layout.md'))
    await rm(join(store, 'INDEX.md'), { recursive: true })
    const repaired = await command(cwd, ['reindex', '--root', store])
    expect(repaired.exitCode, repaired.stderr).toBe(0)
    expect(await readFile(join(store, 'documents/homepage-layout.md'))).toEqual(before)
  })

  it('prevents two independent writers from replacing the same revision', async () => {
    const cwd = await workspace()
    const original = await save(cwd, topic())
    const writes = await Promise.all([
      command(cwd, ['put', '--root', original.root], topic({ body: 'First writer.', expectedRevision: original.revision })),
      command(cwd, ['put', '--root', original.root], topic({ body: 'Second writer.', expectedRevision: original.revision })),
    ])
    expect(writes.map(result => result.exitCode).sort()).toEqual([0, 1])
    const rejected = writes.find(result => result.exitCode === 1)!
    expect(['BUSY', 'REVISION_CONFLICT']).toContain((JSON.parse(rejected.stderr) as { error: { code: string } }).error.code)
    const winner = JSON.parse(writes.find(result => result.exitCode === 0)!.stdout) as DocumentResult
    const recalled = await command(cwd, ['get', '--root', original.root, '--id', original.id])
    expect(JSON.parse(recalled.stdout)).toMatchObject({ revision: winner.revision, body: winner.body })
    expect(await readdir(original.root)).not.toContain('.write.lock')
  })

  it('leaves the document unchanged on an invalid attachment and releases the writer lock', async () => {
    const cwd = await workspace()
    const original = await save(cwd, topic())
    const before = await readFile(original.path)
    const source = join(cwd, 'invalid.png')
    await writeFile(source, 'plain text')
    const result = await command(cwd, ['put', '--root', original.root], topic({
      expectedRevision: original.revision, images: [{ source, caption: 'Invalid reference' }],
    }))
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: 'INVALID_IMAGE' } })
    expect(await readFile(original.path)).toEqual(before)
    expect(await readdir(original.root)).not.toContain('.write.lock')
    await save(cwd, topic({ expectedRevision: original.revision, body: 'Recovery succeeds.' }))
  })

  it('enforces the configured image byte limit and refuses traversal identifiers', async () => {
    const cwd = await workspace()
    const source = join(cwd, 'reference.png')
    await writeFile(source, png)
    const oversized = await command(cwd, ['put', '--root', join(cwd, 'memory'), '--max-image-bytes', '1'], topic({ images: [{ source, caption: 'Reference' }] }))
    expect(JSON.parse(oversized.stderr)).toMatchObject({ error: { code: 'IMAGE_TOO_LARGE' } })
    const invalid = await command(cwd, ['put', '--root', join(cwd, 'memory')], topic({ id: '../../outside' }))
    expect(JSON.parse(invalid.stderr)).toMatchObject({ error: { code: 'INVALID_INPUT' } })
    expect(await readdir(join(cwd, 'memory/documents'))).toEqual([])
  })

  it('reports invalid persisted metadata without hiding it or overwriting another topic', async () => {
    const cwd = await workspace()
    const original = await save(cwd, topic())
    await writeFile(original.path, '# Missing metadata\n')
    const found = await command(cwd, ['search', '--root', original.root])
    expect(JSON.parse(found.stderr)).toMatchObject({ error: { code: 'INVALID_DOCUMENT' } })
    const blocked = await command(cwd, ['put', '--root', original.root], topic({ id: 'another-topic' }))
    expect(JSON.parse(blocked.stderr)).toMatchObject({ error: { code: 'INVALID_DOCUMENT' } })
    expect(await readdir(join(original.root, 'documents'))).toEqual(['homepage-layout.md'])
  })

  it('uses the nearest project from nested working directories and keeps absent recall read-only', async () => {
    const cwd = await workspace()
    await mkdir(join(cwd, '.git'))
    const nested = join(cwd, 'nested/folder')
    await mkdir(nested, { recursive: true })
    const empty = await command(nested, ['search'])
    expect(JSON.parse(empty.stdout)).toMatchObject({ root: join(cwd, '.dsh/memory'), total: 0 })
    expect(await readdir(cwd)).not.toContain('.dsh')
    const created = await command(nested, ['put'], topic())
    expect(created.exitCode, created.stderr).toBe(0)
    expect(JSON.parse(created.stdout)).toMatchObject({ root: join(cwd, '.dsh/memory') })
  })

  // Windows symlink creation requires host privileges that this fixture does not acquire.
  it.skipIf(process.platform === 'win32')('refuses symbolic-link document directories before reading or writing external files', async () => {
    const cwd = await workspace()
    const external = join(cwd, 'external')
    const store = join(cwd, 'memory')
    await mkdir(external)
    await mkdir(store)
    await symlink(external, join(store, 'documents'))
    const result = await command(cwd, ['put', '--root', store], topic())
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: 'INVALID_DOCUMENT' } })
    expect(await readdir(external)).toEqual([])
  })

  it('loads a copied skill through Cordis and runs its colocated helper without repository dependencies', async () => {
    const cwd = await workspace()
    const userSkills = join(cwd, 'user-skills')
    const copied = join(userSkills, 'dsh-memory-documents')
    await cp(skillRoot, copied, { recursive: true })
    const ctx = await boot('document-memory-test', join(import.meta.dirname, 'fixtures/document-memory.cordis.yml'), [
      { id: 'filesystem', config: { includeDefaultRoots: false, watch: false, customSkillDirs: [userSkills] } },
    ], (ctx) => {
      contexts.add(ctx)
      ctx.loader.builtins['document-memory-test-skills'] = SkillRegistry
      ctx.loader.builtins['document-memory-test-filesystem'] = SkillFilesystem
    })
    const loaded = await ctx.skills.get('dsh-memory-documents', { cwd })
    expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: copied.replaceAll('\\', '/') })
    expect(loaded?.content).toContain('call the existing `read_image` tool')
    const source = await readFile(join(copied, 'SKILL.md'), 'utf8')
    expect(loaded?.content).toBe(source.replace(/^---\n[\s\S]*?\n---\n/u, '').trim())
    const result = await command(cwd, ['put', '--root', join(cwd, 'memory')], topic(), join(copied, 'scripts/memory-documents.mjs'))
    expect(result.exitCode, result.stderr).toBe(0)
    const doc = JSON.parse(result.stdout) as DocumentResult
    expect(createHash('sha256').update(await readFile(doc.path)).digest('hex')).toBe(doc.revision)
    await ctx.fiber.dispose()
    contexts.delete(ctx)
  })
})
