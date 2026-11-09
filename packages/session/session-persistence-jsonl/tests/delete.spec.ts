/** Permanent deletion exercises real artifacts and write exclusion across backend instances. */
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as Jsonl from '../src/index.ts'
import { LEASE_FILENAME } from '../src/lease.ts'
import { meta, oneTurnLog } from '../../session-persistence/tests/contract.ts'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

const removalFailure = vi.hoisted(() => ({ path: undefined as string | undefined }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rm: ((...args: Parameters<typeof actual.rm>) => String(args[0]) === removalFailure.path
      ? Promise.reject(new Error('sidecar removal failed')) : actual.rm(...args)),
  }
})

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-delete-'))
  const contexts: Context[] = []
  onTestFinished(async () => {
    const results = await Promise.allSettled(contexts.map(ctx => ctx.fiber.dispose()))
    await rm(root, { recursive: true, force: true })
    const failures: unknown[] = results.flatMap((result): unknown[] => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length > 0) throw new AggregateError(failures, 'deletion fixture cleanup failed')
  })
  const instance = async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Jsonl, { root, compression: 'none' })
    return ctx
  }
  return { root, ctx: await instance(), instance }
}

describe('permanent JSONL Session deletion', () => {
  it('removes every generation and sidecar, retains project files, and stays absent after reopen', async () => {
    const h = await harness()
    const header = meta('delete-all-generations')
    const projectFile = join(h.root, 'keep-project.txt')
    await writeFile(projectFile, 'keep')
    const handle = await h.ctx.sessionPersistence.create(header)
    await handle.append(oneTurnLog())
    await handle.close()
    const location = (await h.ctx.sessionPersistence.stat(header.id))!.location!
    const dir = dirname(location.path)
    const lock = process.platform === 'win32' ? undefined : await stat(join(dir, LEASE_FILENAME), { bigint: true })
    await writeFile(join(dir, 'session.jsonl'), 'historical generation')
    await writeFile(join(dir, 'sidecar.json'), '{}')
    await mkdir(join(dir, 'derived'))
    await writeFile(join(dir, 'derived', 'cache.json'), '{}')
    await symlink(h.root, join(dir, 'external-link'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(await h.ctx.sessionPersistence.delete(header.id)).toBe(true)
    expect(await readdir(dir)).toEqual(process.platform === 'win32' ? [] : [LEASE_FILENAME])
    if (lock !== undefined) {
      expect((await stat(join(dir, LEASE_FILENAME), { bigint: true })).ino).toBe(lock.ino)
    }
    expect(await readFile(projectFile, 'utf8')).toBe('keep')
    const reopened = await h.instance()
    expect(await reopened.sessionPersistence.stat(header.id)).toBeUndefined()
    expect(await reopened.sessionPersistence.list()).toEqual([])
    await expect(reopened.sessionPersistence.open(header.id, 'read')).rejects.toMatchObject({ name: 'SessionPersistenceNotFoundError' })
  })

  it('refuses active writers in this instance and another instance without removing data', async () => {
    const h = await harness()
    const header = meta('delete-owned')
    const writer = await h.ctx.sessionPersistence.create(header)
    await writer.append(oneTurnLog())
    const other = await h.instance()
    await expect(h.ctx.sessionPersistence.delete(header.id)).rejects.toMatchObject({ name: 'SessionAlreadyOwnedError' })
    await expect(other.sessionPersistence.delete(header.id)).rejects.toMatchObject({ name: 'SessionAlreadyOwnedError' })
    expect((await h.ctx.sessionPersistence.stat(header.id))?.header.id).toBe(header.id)
    await writer.close()
    expect(await other.sessionPersistence.delete(header.id)).toBe(true)
    expect(await h.ctx.sessionPersistence.stat(header.id)).toBeUndefined()
  })

  it('retains the selected log after sidecar failure so a retry can finish deletion', async () => {
    const h = await harness()
    const header = meta('retry-sidecar-cleanup')
    const writer = await h.ctx.sessionPersistence.create(header)
    await writer.append(oneTurnLog())
    await writer.close()
    const path = (await h.ctx.sessionPersistence.stat(header.id))!.location!.path
    const sidecar = join(dirname(path), 'sidecar.json')
    await writeFile(sidecar, '{}')
    removalFailure.path = sidecar
    onTestFinished(() => { removalFailure.path = undefined })
    await expect(h.ctx.sessionPersistence.delete(header.id)).rejects.toThrow('sidecar removal failed')
    expect((await h.ctx.sessionPersistence.stat(header.id))?.header.id).toBe(header.id)
    removalFailure.path = undefined
    expect(await h.ctx.sessionPersistence.delete(header.id)).toBe(true)
    expect(await h.ctx.sessionPersistence.stat(header.id)).toBeUndefined()
  })

  it('retries derived cleanup even when the durable Session is already absent', async () => {
    const h = await harness()
    const id = SessionId('already-gone')
    let attempts = 0
    h.ctx.on('session-persistence/deleted', () => {
      attempts += 1
      if (attempts === 1) throw new Error('cache unavailable')
    })
    await expect(h.ctx.sessionPersistence.delete(id)).rejects.toThrow('cache unavailable')
    expect(await h.ctx.sessionPersistence.delete(id)).toBe(false)
    expect(attempts).toBe(2)
  })
})
