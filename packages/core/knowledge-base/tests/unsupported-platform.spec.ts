import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { KnowledgeSpace } from '../src/types.ts'

vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), platform: () => 'darwin', arch: () => 'x64' }))
vi.mock('@lancedb/lancedb', () => { throw new Error('The native library must not load on Intel macOS') })

it('keeps the default service available on Intel macOS without loading native bindings or writing index files', async () => {
  const { KnowledgeIndex } = await import('../src/engine.ts')
  const { resolveConfig } = await import('../src/config.ts')
  const root = await mkdtemp(join(tmpdir(), 'knowledge-unavailable-'))
  const index = new KnowledgeIndex(resolveConfig({ path: join(root, 'index') }))
  const space = brandString<KnowledgeSpace>('workspace')
  const signal = new AbortController().signal
  try {
    await index.open()
    expect(await readdir(root)).toEqual([])
    expect(await index.dashboard(space, '', 0, signal)).toMatchObject({ availability: 'unsupported-platform', documents: [] })
    await expect(index.search(space, 'source', 1, signal)).rejects.toMatchObject({ code: 'KNOWLEDGE_UNSUPPORTED_PLATFORM' })
    await expect(index.import(space, async () => { throw new Error('No source should be read') }, signal))
      .rejects.toMatchObject({ code: 'KNOWLEDGE_UNSUPPORTED_PLATFORM' })
  } finally {
    await index.close()
    await rm(root, { recursive: true, force: true })
  }
})
