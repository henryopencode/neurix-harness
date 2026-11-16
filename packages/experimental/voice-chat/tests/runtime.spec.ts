/** External executables receive ordinary files even when the plugin is read from an Electron archive. */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { materializeRuntime } from '../src/runtime.ts'

it('provides readable Python inputs outside app.asar and repairs an incomplete preparation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-voice-runtime-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  const archive = join(root, 'app.asar')
  await writeFile(archive, 'archive container')
  await expect(readFile(join(archive, 'runtime', 'requirements.txt'))).rejects.toThrow()
  const paths = await materializeRuntime(join(root, 'user-cache'), new AbortController().signal)
  expect(await readFile(paths.requirements, 'utf8')).toContain('mlx-audio==')
  expect(await readFile(paths.worker, 'utf8')).toContain('server.serve_forever()')
  expect(paths.worker).toContain(join(root, 'user-cache', 'runtime'))
  await writeFile(paths.worker, 'incomplete script')
  expect(await materializeRuntime(join(root, 'user-cache'), new AbortController().signal)).toEqual(paths)
  expect(await readFile(paths.worker, 'utf8')).toContain('server.serve_forever()')
})

it('does not publish files after cancellation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-voice-runtime-cancel-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  await expect(materializeRuntime(root, AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
  const files = await readdir(root, { recursive: true })
  expect(files.some(file => file.endsWith('.py') || file.endsWith('.txt') || file.endsWith('.part'))).toBe(false)
})
