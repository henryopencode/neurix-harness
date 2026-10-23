/** LaunchServices handoff, command lifetime, and exact-process window discovery. */

import { ChildProcess } from 'node:child_process'
import type { ExecFileOptions } from 'node:child_process'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { launchMacApplication, withMacApplicationLaunch } from '../src/launch.ts'
import { ComputerError } from '../src/native.ts'

type ExecuteFile = (command: string, args: string[], options: ExecFileOptions,
  callback: (error: Error | null, stdout: string) => void) => ChildProcess
const command = vi.hoisted(() => ({ execFile: vi.fn<ExecuteFile>() }))
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), execFile: command.execFile }))
const signal = new AbortController().signal
const application = { status: 'launched' as const, pid: 9, bundle_id: 'ai.neurix.fixture', name: 'Fixture' }
let child: ChildProcess
let complete: (error: Error | null, stdout: string) => void

beforeEach(() => {
  child = new ChildProcess()
  command.execFile.mockImplementation((_command, _args, _options, callback) => {
    complete = callback
    return child
  })
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); command.execFile.mockReset() })

it('passes the exact bundle separately from code, scrubs secrets, and waits for child closure', async () => {
  vi.stubEnv('NEURIX_LAUNCH_TEST_SECRET', 'private-test-value')
  const launching = launchMacApplication('ai.neurix.fixture', signal)
  let settled = false
  void launching.then(() => { settled = true })
  const [executable, args, options] = command.execFile.mock.calls[0]!
  expect(executable).toBe('/usr/bin/osascript')
  expect(args.slice(0, 3)).toEqual(['-l', 'JavaScript', '-e'])
  expect(args.at(-1)).toBe('ai.neurix.fixture')
  expect(args.at(-2)).toBe('background')
  expect(args[3]).toContain('NSWorkspaceLaunchWithoutActivation')
  expect(options.env).not.toHaveProperty('NEURIX_LAUNCH_TEST_SECRET')
  complete(null, JSON.stringify(application))
  await Promise.resolve()
  expect(settled).toBe(false)
  child.emit('close', 0)
  await expect(launching).resolves.toEqual(application)
})

it('passes foreground activation explicitly to LaunchServices when opening a foreground application', async () => {
  const launching = launchMacApplication('ai.neurix.fixture', signal, 'foreground')
  expect(command.execFile.mock.calls[0]?.[1].slice(-2)).toEqual(['foreground', 'ai.neurix.fixture'])
  complete(null, JSON.stringify(application)); child.emit('close', 0)
  await expect(launching).resolves.toEqual(application)
})

it('waits for termination after a command abort and surfaces command errors', async () => {
  const launching = launchMacApplication('ai.neurix.fixture', signal)
  const failed = expect(launching).rejects.toThrow('aborted')
  complete(new Error('aborted'), '')
  child.emit('close', null, 'SIGTERM')
  await failed
})

it.each([
  ['not_installed', 'APP_NOT_INSTALLED', 'none'],
  ['launch_failed', 'LAUNCH_FAILED', 'possible'],
])('reports %s without retrying the command', async (status, code, effect) => {
  const launching = launchMacApplication('ai.neurix.fixture', signal)
  const failed = expect(launching).rejects.toMatchObject({ code, effect })
  complete(null, JSON.stringify({ status }))
  child.emit('close', 0)
  await failed
  expect(command.execFile).toHaveBeenCalledTimes(1)
})

it('rejects canceled admission, protected permission hosts, and invalid native stdout', async () => {
  await expect(launchMacApplication('ai.neurix.fixture', AbortSignal.abort(new Error('canceled')))).rejects.toThrow('canceled')
  for (const id of ['com.trycua.driver', 'com.trycua.driver.local']) {
    await expect(launchMacApplication(id, signal)).rejects.toMatchObject({ code: 'PROTECTED_APPLICATION', effect: 'none' })
  }
  expect(command.execFile).not.toHaveBeenCalled()
  const launching = launchMacApplication('ai.neurix.fixture', signal)
  const failed = expect(launching).rejects.toThrow()
  complete(null, '{"status":"launched","pid":"invalid"}')
  child.emit('close', 0)
  await failed
})

it('returns windows for the launched PID without invoking the SDK application scan', async () => {
  const callTool = vi.fn(async () => ({ rawJson: JSON.stringify({
    structuredContent: { windows: [{ pid: 9, window_id: 7 }, { pid: 10, window_id: 8 }] },
  }) }))
  const launch = vi.fn(async () => application)
  const driver = withMacApplicationLaunch({ callTool }, launch)
  const result = await driver.callTool('launch_app', '{"bundle_id":"ai.neurix.fixture"}', { signal })
  expect(JSON.parse(result.rawJson)).toMatchObject({ structuredContent: {
    pid: 9, windows: [{ pid: 9, window_id: 7 }], launch_state: { window_ready: true },
  } })
  expect(callTool.mock.calls).toHaveLength(1)
  expect(callTool).toHaveBeenCalledWith('list_windows', '{"pid":9,"on_screen_only":false}', { signal })
  await driver.callTool('get_window_state', '{}', { signal })
  expect(callTool).toHaveBeenLastCalledWith('get_window_state', '{}', { signal })
  expect(launch).toHaveBeenCalledTimes(1)
})

it('keeps successful launch distinct from failed or canceled window discovery', async () => {
  const canceled = new AbortController()
  const driver = withMacApplicationLaunch({ callTool: async () => {
    throw 'unavailable'
  } }, async () => application)
  await expect(driver.callTool('launch_app', '{"bundle_id":"ai.neurix.fixture"}', { signal })).rejects.toMatchObject({ code: 'OBSERVATION_FAILED', effect: 'completed' })
  canceled.abort(new Error('Stopped after launch'))
  await expect(driver.callTool('launch_app', '{"bundle_id":"ai.neurix.fixture"}', { signal: canceled.signal })).rejects.toThrow('Stopped after launch')
  const refused = withMacApplicationLaunch({ callTool: async () => ({ rawJson: '{}' }) }, async () => { throw new ComputerError('APP_NOT_INSTALLED', 'missing', 'none', 'Check the identifier.') })
  await expect(refused.callTool('launch_app', '{"bundle_id":"ai.neurix.fixture"}', { signal })).rejects.toMatchObject({ code: 'APP_NOT_INSTALLED', effect: 'none' })
})
