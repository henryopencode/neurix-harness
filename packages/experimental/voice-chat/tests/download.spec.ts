/** Managed downloads publish only verified files and preserve previously completed caches. */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { downloadAsset } from '../src/runtime.ts'

const limits = { connections: 2, chunkBytes: 4 }

async function fixture(body: Buffer, status = 200, ranges: 'none' | 'valid' | 'invalid' = 'none') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-voice-assets-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  let requests = 0
  const waiting: (() => void)[] = []
  const server = createServer((request, response) => {
    requests++
    const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '')
    if (ranges === 'none' || !range) {
      response.writeHead(status, ranges === 'none' ? {} : { 'Accept-Ranges': 'bytes' }); response.end(body); return
    }
    const start = Number(range[1]), end = Number(range[2])
    const send = (): void => {
      response.writeHead(206, { 'Content-Range': `bytes ${start}-${ranges === 'invalid' ? end + 1 : end}/${body.length}` })
      response.end(body.subarray(start, end + 1))
    }
    if (ranges === 'invalid') { send(); return }
    // A sequential implementation cannot release this pair: overlap is the observable behavior.
    waiting.push(send)
    if (waiting.length === 2) for (const finish of waiting.splice(0)) finish()
  })
  onTestFinished(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve() })
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing allocated HTTP port')
  const asset = { name: 'model.bin', url: `http://127.0.0.1:${address.port}/model`, bytes: body.length,
    sha256: createHash('sha256').update(body).digest('hex') }
  return { root, path: join(root, asset.name), asset, requests: () => requests }
}

it('publishes a verified model once and reuses it without network requests', async () => {
  const body = Buffer.from('pinned voice checkpoint'), b = await fixture(body), progress: number[] = []
  await downloadAsset(b.asset, b.path, new AbortController().signal, (value) => { progress.push(value) }, limits)
  expect(await readFile(b.path)).toEqual(body)
  expect(await readdir(b.root)).toEqual(['model.bin'])
  await downloadAsset(b.asset, b.path, new AbortController().signal, () => {}, limits)
  expect(b.requests()).toBe(1); expect(progress.at(-1)).toBe(body.length)
})

it('rejects a bad checksum without replacing an existing file or retaining partials', async () => {
  const b = await fixture(Buffer.from('corrupt checkpoint'))
  await writeFile(b.path, 'previous cache')
  await expect(downloadAsset({ ...b.asset, sha256: '0'.repeat(64) }, b.path,
    new AbortController().signal, () => {}, limits)).rejects.toThrow('checksum')
  expect(await readFile(b.path, 'utf8')).toBe('previous cache')
  expect(await readdir(b.root)).toEqual(['model.bin'])
})

it('rejects HTTP errors, oversized responses and cancellation without publishing a model', async () => {
  const b = await fixture(Buffer.from('checkpoint')), unavailable = await fixture(Buffer.from('offline'), 503)
  await expect(downloadAsset(unavailable.asset, unavailable.path, new AbortController().signal, () => {}, limits)).rejects.toThrow('503')
  await expect(downloadAsset({ ...b.asset, bytes: 1 }, b.path, new AbortController().signal, () => {}, limits)).rejects.toThrow('byte length')
  await expect(downloadAsset(b.asset, b.path, AbortSignal.abort(new Error('cancelled')), () => {}, limits)).rejects.toThrow('cancelled')
  expect(await readdir(b.root)).toEqual([])
  expect(await readdir(unavailable.root)).toEqual([])
})

it('downloads independent byte ranges concurrently and verifies the complete checkpoint', async () => {
  const body = Buffer.from('0123456789abcdef'), b = await fixture(body, 200, 'valid'), progress: number[] = []
  await downloadAsset(b.asset, b.path, new AbortController().signal, (value) => { progress.push(value) }, limits)
  expect(await readFile(b.path)).toEqual(body)
  expect(b.requests()).toBe(5)
  expect(progress.at(-1)).toBe(body.length)
  expect(await readdir(b.root)).toEqual(['model.bin'])
})

it('joins range cancellation and removes partial data when an origin sends invalid ranges', async () => {
  const b = await fixture(Buffer.from('0123456789abcdef'), 200, 'invalid')
  await expect(downloadAsset(b.asset, b.path, new AbortController().signal, () => {}, limits)).rejects.toThrow()
  expect(await readdir(b.root)).toEqual([])
})
