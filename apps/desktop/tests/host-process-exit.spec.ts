/** Host completion follows its process exit even when inherited output pipes remain open. */
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { spawn } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopHostProcess, DesktopHostUncleanExitError } from '../src/host-process.ts'

const mocks = vi.hoisted(() => ({ spawn: vi.fn<typeof spawn>() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
afterEach(() => { vi.useRealTimers(); mocks.spawn.mockReset() })

async function fixture() {
  const child = Object.assign(new EventEmitter(), {
    connected: true, exitCode: null as number | null, signalCode: null as NodeJS.Signals | null,
    stdout: new PassThrough(), stderr: new PassThrough(),
    send: vi.fn((_message: object, callback?: (error: Error | null) => void) => { callback?.(null); return true }),
    kill: vi.fn(() => true),
  })
  mocks.spawn.mockReturnValue(child as never)
  const host = new DesktopHostProcess(process.execPath, '/fixture/runtime', '/fixture/profile')
  const starting = host.start()
  child.emit('message', { type: 'ready', url: 'http://127.0.0.1:1/' })
  await starting
  return { child, host }
}

it('accepts acknowledged zero exit before output pipe closure and releases its readers', async () => {
  vi.useFakeTimers()
  const { child, host } = await fixture()
  const stopping = host.stop(true)
  let settled = false
  const observed = stopping.then(() => { settled = true })
  try {
    child.emit('message', { type: 'shutdown-complete' })
    child.exitCode = 0
    child.emit('exit', 0, null)
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)
    expect(child.kill).not.toHaveBeenCalled()
    expect(child.stdout.destroyed).toBe(true)
    expect(child.stderr.destroyed).toBe(true)
    await observed
  } finally {
    child.emit('close', 0, null)
    await stopping.catch(() => undefined)
    child.stdout.destroy()
    child.stderr.destroy()
  }
})

it.each([false, true])('refuses an exited Host when acknowledgement is %s and exit is unclean', async (acknowledged) => {
  vi.useFakeTimers()
  const { child, host } = await fixture()
  const stopping = host.stop(true)
  const rejected = expect(stopping).rejects.toBeInstanceOf(DesktopHostUncleanExitError)
  if (acknowledged) child.emit('message', { type: 'shutdown-complete' })
  child.exitCode = acknowledged ? 1 : 0
  child.emit('exit', child.exitCode, null)
  try {
    await vi.advanceTimersByTimeAsync(0)
    await rejected
  } finally {
    child.emit('close', child.exitCode, null)
    await stopping.catch(() => undefined)
    child.stdout.destroy()
    child.stderr.destroy()
  }
})
