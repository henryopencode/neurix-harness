/** Exact-window system input with shared desktop and picture-in-picture feedback. @module */

import { setTimeout as delay } from 'node:timers/promises'
import { ComputerError, type NativeResult } from './native.ts'
import type { ResolvedConfig } from './index.ts'
import type { IndependentFeedback, ScreenRect } from './feedback.ts'
import type { ComputerInput } from './schema.ts'
import { nativeWindows } from './browser-window.ts'

type Point = { x: number; y: number }
type Input = Extract<ComputerInput, { action: 'move' | 'click' | 'type' | 'key' | 'scroll' | 'drag' }>
type Call = (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<NativeResult>

/** Native identity and screenshot calibration captured before system input. */
export interface ForegroundTarget {
  owner: string
  pid: number
  windowId: number
  bounds: ScreenRect
  focus: 'accessibility' | 'window'
  scaleX: number
  scaleY: number
  capture?: ScreenRect
  point?: Point
  destination?: Point
  wheel?: () => Promise<void>
}

/**
 * Activate one exact window and deliver physical input without AXPress substitution.
 * One AppKit worker posts drag events, draws their positions, and releases input.
 * @param target - current native window and screen-point endpoints.
 * @param input - validated action; all addressing has already been resolved.
 * @param config - Agent-captured input pacing and display choices.
 * @param feedback - one display state shared by the desktop and preview.
 * @param call - serialized native operations with the owning lifecycle session.
 * @param signal - tool cancellation and deadline.
 * @returns after input settles; the caller verifies the resulting application state.
 */
export async function foregroundAction(target: ForegroundTarget, input: Input, config: ResolvedConfig,
  feedback: IndependentFeedback, call: Call, signal: AbortSignal): Promise<void> {
  const { pid, windowId, bounds, point } = target
  const requirePoint = () => {
    if (point === undefined) throw new ComputerError('POSITION_REQUIRED', 'This action needs a visible element or screenshot point.',
      'none', 'Observe the exact window and select a visible element or screenshot point.')
    return point
  }
  for (const at of [point, target.destination]) {
    if (at !== undefined && (at.x < bounds.x || at.y < bounds.y || at.x >= bounds.x + bounds.width || at.y >= bounds.y + bounds.height)) {
      throw new ComputerError('POINT_OUTSIDE_WINDOW', 'The point is outside the observed window.', 'none', 'Observe the same window and choose a visible point.')
    }
  }
  if (input.action !== 'key' && input.action !== 'type') requirePoint()
  if (input.action === 'scroll' && target.wheel === undefined && (!Number.isInteger(input.amount) || input.amount > 50)) {
    throw new ComputerError('INVALID_ARGUMENTS', 'Native scroll amount must be a whole number from 1 to 50.', 'none',
      'Supply wheel notches from 1 to 50 for a native window.')
  }
  if (input.action === 'drag' && target.destination === undefined) throw new ComputerError('DESTINATION_REQUIRED',
    'Dragging requires a visible destination.', 'none', 'Supply toX and toY from a fresh screenshot, or an observed browser toLocator.')
  const windows = nativeWindows.parse((await call('list_windows', { pid, on_screen_only: false }, signal)).structuredContent).windows
  const current = windows.find(window => window.pid === pid && window.window_id === windowId)
  if (current?.bounds === undefined || (['x', 'y', 'width', 'height'] as const).some(key => current.bounds?.[key] !== bounds[key])) {
    throw new ComputerError('WINDOW_MOVED', 'The target window changed after observation.', 'none', 'Observe the same window before continuing.')
  }
  feedback.select(target.owner, windowId, bounds, target.capture ?? bounds)
  await feedback.prepare(signal)
  await feedback.activate(pid, signal)
  if (target.focus === 'window') await feedback.verifyWindow(pid, windowId, signal)
  else await call('bring_to_front', { pid, window_id: windowId }, signal)
  if (point !== undefined) await feedback.move(point, windowId, bounds, signal, config.cursorMoveDurationMs, true)
  signal.throwIfAborted()
  const args = { pid, window_id: windowId, delivery_mode: 'foreground' }
  const pixels = (at: Point) => ({ x: (at.x - bounds.x) * target.scaleX, y: (at.y - bounds.y) * target.scaleY })
  const click = async (button: 'left' | 'right', count: number) => {
    await feedback.update({ pressed: true, idleMs: config.overlayIdleMs }, signal)
    try { await feedback.click(pid, requirePoint(), button, count, signal) } finally {
      if (!signal.aborted) await feedback.update({ pressed: false, click: true, idleMs: config.overlayIdleMs }, signal)
    }
  }
  const keys = async (names: readonly string[]) => {
    const aliases: Record<string, string> = { meta: 'cmd', command: 'cmd', control: 'ctrl', option: 'alt', enter: 'return',
      arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', backspace: 'delete' }
    const normalized = names.map(key => aliases[key.toLowerCase()] ?? key.toLowerCase())
    await feedback.show(names, signal)
    await feedback.key(pid, normalized, signal)
    if (config.keySettleMs > 0) await delay(config.keySettleMs, undefined, { signal })
  }
  switch (input.action) {
    case 'move': return
    case 'click': await click(input.button, input.count); return
    case 'key': await keys(input.keys); return
    case 'type':
      if (point !== undefined) await click('left', 1)
      if (input.replace) {
        await keys(['cmd', 'up'])
        await keys(['cmd', 'shift', 'down'])
        if (!input.text) await keys(['delete'])
      }
      await feedback.show('type', signal, true)
      try {
        await feedback.type(pid, input.text, signal)
      } finally {
        if (!signal.aborted) await feedback.show('type', signal)
      }
      return
    case 'scroll':
      await feedback.update({ scroll: input.direction, hold: true, idleMs: config.overlayIdleMs }, signal)
      try {
        if (target.wheel !== undefined) await target.wheel()
        else {
          const steps = Math.ceil(input.amount)
          for (let step = 0; step < steps; step++) {
            await call('scroll', { ...args, ...pixels(requirePoint()), direction: input.direction, amount: 1 }, signal)
            if (config.scrollDurationMs > 0) await delay(config.scrollDurationMs / steps, undefined, { signal })
          }
        }
      } finally {
        if (!signal.aborted) await feedback.update({ scroll: input.direction, hold: false, idleMs: config.overlayIdleMs }, signal)
      }
      return
    case 'drag': {
      const end = target.destination
      if (end === undefined) return
      await feedback.update({ pressed: true, idleMs: config.overlayIdleMs }, signal)
      try {
        await feedback.drag(pid, requirePoint(), end, signal)
      } finally {
        if (!signal.aborted) await feedback.update({ pressed: false, click: true, idleMs: config.overlayIdleMs }, signal)
      }
      return
    }
  }
}
