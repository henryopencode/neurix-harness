/** Native cancellation cannot block the Host, replay input, or retain stale SDK sessions. */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { z } from 'zod'
import { IsolatedNativeDriver, NativeDriverProcess } from '../src/native-driver.ts'
import type { NativeDriver } from '../src/native-driver.ts'

const fixture = new URL('./fixtures/native-driver-process.mjs', import.meta.url).href
const signal = new AbortController().signal
const drivers: NativeDriver[] = []
const roots: string[] = []
const create = (url = fixture) => { const driver = new NativeDriverProcess(url); drivers.push(driver); return driver }
afterEach(async () => {
  await Promise.all(drivers.splice(0).map(driver => driver.close()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('keeps the Host responsive and awaits process exit when native code blocks synchronously', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-driver-'))
  roots.push(root)
  const readyPath = join(root, 'ready.json')
  const driver = create()
  await driver.callTool('start_session', '{"session":"before-crash"}', { signal })
  const cancel = new AbortController()
  const operation = driver.callTool('block', JSON.stringify({ readyPath, session: 'before-crash' }), { signal: cancel.signal })
  const rejected = expect(operation).rejects.toThrow()
  let pid: number | undefined
  await expect.poll(async () => {
    try { pid = z.object({ pid: z.number().positive() }).parse(JSON.parse(await readFile(readyPath, 'utf8'))).pid; return true } catch (error) {
      if (z.object({ code: z.literal('ENOENT') }).safeParse(error).success) return false
      throw error
    }
  }).toBe(true)
  const queued = expect(driver.callTool('echo', '{"session":"before-crash"}', { signal })).rejects.toThrow()
  cancel.abort(new Error('Stop native work'))
  await rejected
  await queued
  expect(pid).toBeDefined()
  expect(() => process.kill(pid!, 0)).toThrow()
  await expect(driver.callTool('start_session', '{"session":"before-crash"}', { signal }))
    .rejects.toMatchObject({ code: 'session_ended', effect: 'none' })
  const restarted = await driver.callTool('start_session', '{"session":"after-crash"}', { signal })
  expect(JSON.parse(restarted.rawJson)).toMatchObject({ structuredContent: { name: 'start_session', session: 'after-crash' } })
  const nextPid = z.object({ structuredContent: z.object({ pid: z.number() }) }).parse(JSON.parse(restarted.rawJson)).structuredContent.pid
  expect(nextPid).not.toBe(pid)
})

it('keeps input working while preview native code blocks and after the preview is canceled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-preview-driver-'))
  roots.push(root)
  const readyPath = join(root, 'ready.json')
  const driver = new IsolatedNativeDriver(fixture)
  drivers.push(driver)
  const before = await driver.callTool('start_session', '{"session":"input-session"}', { signal })
  const cancel = new AbortController()
  const preview = expect(driver.callTool('get_window_state', JSON.stringify({ display_only: true,
    session: 'input-session', block: true, readyPath }), { signal: cancel.signal })).rejects.toThrow()
  await expect.poll(async () => {
    try { await readFile(readyPath); return true } catch (error) {
      if (z.object({ code: z.literal('ENOENT') }).safeParse(error).success) return false
      throw error
    }
  }).toBe(true)
  expect(await driver.callTool('start_session', '{"session":"input-session"}', { signal })).toEqual(before)
  cancel.abort(new Error('Preview stopped'))
  await preview
  expect(await driver.callTool('start_session', '{"session":"input-session"}', { signal })).toEqual(before)
  await expect(driver.callTool('get_window_state', '{"display_only":true,"session":"input-session"}', { signal }))
    .resolves.toHaveProperty('rawJson')
})

it('reports SDK errors without losing the process, then refuses calls after awaited disposal', async () => {
  const driver = create()
  await expect(driver.callTool('fail', '{}', { signal })).rejects.toThrow('External SDK failure')
  await expect(driver.callTool('echo', '{}', { signal })).resolves.toHaveProperty('rawJson')
  await driver.close()
  await expect(driver.callTool('echo', '{}', { signal })).rejects.toMatchObject({ code: 'NATIVE_DRIVER_CLOSED', effect: 'none' })
})

it('kills invalid IPC producers and reports native module startup failure', async () => {
  await expect(create().callTool('invalid_ipc', '{}', { signal })).rejects.toThrow('invalid IPC data')
  await expect(create('file:///missing-native-sdk.mjs').callTool('echo', '{}', { signal })).rejects.toThrow('missing-native-sdk')
})

it('does not launch a process for pre-canceled work or an already absent session close', async () => {
  const driver = create('file:///missing-native-sdk.mjs')
  const cancel = new AbortController()
  cancel.abort(new Error('Not admitted'))
  await expect(driver.callTool('echo', '{}', { signal: cancel.signal })).rejects.toThrow('Not admitted')
  await expect(driver.callTool('end_session', '{"session":"absent"}', { signal })).resolves.toEqual({ rawJson: '{"content":[]}' })
})

it('renews a preview session after the SDK reports its idle expiry', async () => {
  const driver = new IsolatedNativeDriver(fixture + '?expire-preview')
  drivers.push(driver)
  const result = await driver.callTool('get_window_state', '{"display_only":true}', { signal })
  expect(JSON.parse(result.rawJson)).toMatchObject({ structuredContent: { name: 'get_window_state', previewStarts: 2 } })
})
