/** Post-teardown process completion preserves JavaScript cleanup and zero-exit semantics. */
import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { finishHostProcess, prepareHostProcessExit } from '../src/host-exit.ts'

const bindings = vi.hoisted(() => ({ exit: vi.fn<(code: number) => void>(), load: vi.fn() }))
vi.mock('koffi', () => ({ default: { load: bindings.load } }))

it('runs existing JavaScript exit listeners before the prepared native exit with code zero', () => {
  const events = new EventEmitter()
  const order: string[] = []
  const stopped = new Error('process ended')
  events.once('exit', () => { order.push('cleanup') })
  const runtime = Object.assign(events, { exit: (code: number): never => {
    expect(code).toBe(0)
    events.emit('exit', code)
    throw stopped
  } })
  expect(() => finishHostProcess(runtime, (code) => { expect(code).toBe(0); order.push('native') })).toThrow(stopped)
  expect(order).toEqual(['cleanup', 'native'])
})

it('prepares the native completion only on macOS and leaves other platform exits unchanged', async () => {
  bindings.load.mockReturnValue({ func: () => bindings.exit })
  await prepareHostProcessExit('linux')
  await prepareHostProcessExit('win32')
  expect(bindings.load).not.toHaveBeenCalled()
  await prepareHostProcessExit('darwin')
  expect(bindings.load).toHaveBeenCalledWith(null)
})

it('preserves a failure exit code set by an earlier JavaScript cleanup listener', () => {
  const events = new EventEmitter()
  const stopped = new Error('process ended')
  const codes: number[] = []
  const runtime = Object.assign(events, { exitCode: 0, exit: (code: number): never => {
    events.emit('exit', code)
    throw stopped
  } })
  events.once('exit', () => { runtime.exitCode = 7 })
  expect(() => finishHostProcess(runtime, (code) => { codes.push(code) })).toThrow(stopped)
  expect(codes).toEqual([7])
})
