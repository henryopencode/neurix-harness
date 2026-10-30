/** Owned macOS cursor animation and display-only key feedback. @module */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { z } from 'zod'
import { ComputerError } from './native.ts'
import { overlayScript } from './overlay-script.ts'

const reply = z.object({ id: z.number().optional(), ready: z.boolean().optional(),
  error: z.string().optional(), code: z.string().optional(), key: z.string().optional(),
  point: z.object({ x: z.number(), y: z.number(), at: z.number() }).optional() })

type PointerSample = { x: number; y: number; at: number }

/** One Agent's non-activating display and explicitly requested foreground input. */
export class MacOverlay {
  private child: ChildProcessWithoutNullStreams | undefined
  private exited: Promise<void> = Promise.resolve()
  private readonly pending = new Map<number, PromiseWithResolvers<void> & {
    input: boolean
    onKey?: (key: string) => void
    onPoint?: (point: PointerSample) => void
  }>()
  private nextId = 0

  /**
   * Bind keyboard feedback to a window without placing a pointer or activating it.
   * @param windowId - exact target window.
   * @param bounds - current rectangle in global macOS points.
   * @param signal - owning operation lifetime.
   * @returns after the display process has selected the target.
   */
  async select(windowId: number, bounds: { x: number; y: number; width: number; height: number }, signal: AbortSignal): Promise<void> {
    await this.send({ action: 'target', windowId, bounds }, signal)
  }

  /**
   * Activate the exact process and await its AppKit active state.
   * @param pid - process owning the verified target window.
   * @param signal - operation deadline and cancellation.
   * @returns after the process reports active; cancellation stops the worker.
   */
  async activate(pid: number, signal: AbortSignal): Promise<void> {
    await this.send({ action: 'activate', pid }, signal)
  }

  /**
   * Check exact window ownership and front ordering without requiring an AXWindow.
   * @param pid - already activated owning process.
   * @param windowId - exact observed CGWindowID.
   * @param signal - operation deadline and cancellation.
   * @returns after system window ordering matches; no input is generated.
   */
  async verifyWindow(pid: number, windowId: number, signal: AbortSignal): Promise<void> {
    await this.send({ action: 'verify_window', pid, windowId }, signal)
  }

  /**
   * Animate the independent software cursor to an already validated screen point.
   * @param point - global macOS screen points, with a top-left origin.
   * @param durationMs - configured glide duration.
   * @param idleMs - configured feedback lifetime after arrival.
   * @param signal - owning operation cancellation and deadline.
   * @param visible - whether to show the independent arrow.
   * @param windowId - exact target window, whose stacking order remains unchanged.
   * @param bounds - current target rectangle in global screen points.
   * @param physical - move the system pointer too, only for explicitly selected foreground input.
   * @returns after the cursor arrives; cancellation terminates the display first.
   */
  async move(
    point: { x: number; y: number }, durationMs: number, idleMs: number, signal: AbortSignal, visible: boolean,
    windowId: number, bounds: { x: number; y: number; width: number; height: number }, physical = false,
  ): Promise<void> {
    await this.send({ action: 'move', ...point, durationMs, idleMs, visible, windowId, bounds, physical }, signal)
  }

  /**
   * Send ordered Unicode key events while the selected process remains foreground.
   * @param pid - process already activated and focused by the native driver.
   * @param text - inserted text, retained only until the operation completes.
   * @param delayMs - interval between complete Unicode graphemes.
   * @param signal - input cancellation and deadline; termination stops further events.
   * @param onKey - current input key for display-only feedback.
   * @returns after every key-down/key-up pair has been posted in order.
   */
  async type(pid: number, text: string, delayMs: number, signal: AbortSignal, onKey: (key: string) => void): Promise<void> {
    const characters = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment)
    await this.send({ action: 'type', pid, characters, delayMs }, signal, onKey)
  }

  /**
   * Post one foreground key chord through the same HID queue as Unicode input.
   * @param pid - verified foreground process.
   * @param keys - modifier names followed by one key.
   * @param signal - owning operation cancellation and deadline.
   * @returns after key-down and key-up are posted in order.
   */
  async key(pid: number, keys: readonly string[], signal: AbortSignal): Promise<void> {
    await this.send({ action: 'key', pid, keys }, signal)
  }

  /**
   * Click at the same screen point used by the physical cursor and display.
   * @param pid - verified foreground process.
   * @param point - global macOS screen points.
   * @param button - left or right mouse button.
   * @param count - single or double click.
   * @param signal - owning input cancellation and deadline.
   * @returns after each mouse-down/mouse-up pair is posted.
   */
  async click(pid: number, point: { x: number; y: number }, button: 'left' | 'right', count: number, signal: AbortSignal): Promise<void> {
    await this.send({ action: 'click', pid, ...point, button, count }, signal)
  }

  /**
   * Drive physical drag events and cursor drawing from the same worker trajectory.
   * @param pid - verified foreground target process.
   * @param from - observed global start point.
   * @param to - observed global destination point.
   * @param durationMs - configured drag duration.
   * @param idleMs - feedback lifetime after release.
   * @param signal - input deadline and cancellation; mouse-up precedes cancellation acknowledgement.
   * @param onPoint - delivered pointer samples for preview feedback.
   * @returns after mouse-up; interruption can leave the item at an intermediate position.
   */
  async drag(pid: number, from: { x: number; y: number }, to: { x: number; y: number }, durationMs: number,
    idleMs: number, signal: AbortSignal, onPoint: (point: PointerSample) => void): Promise<void> {
    await this.send({ action: 'drag', pid, from, to, durationMs, idleMs }, signal, undefined, onPoint)
  }

  /**
   * Show a click ring, current key, or shortcut without sending input.
   * @param feedback - physical action indicator or key chord.
   * @param idleMs - configured display lifetime.
   * @param signal - owning operation cancellation and deadline.
   * @returns after AppKit has accepted the feedback.
   */
  async feedback(feedback: {
    click?: boolean
    pressed?: boolean
    typing?: boolean
    key?: string
    label?: string
    hold?: boolean
    scroll?: 'up' | 'down' | 'left' | 'right'
  }, idleMs: number, signal: AbortSignal): Promise<void> {
    await this.send({ action: 'feedback', ...feedback, idleMs }, signal)
  }

  /** Stop animation and await child exit, including after a failed operation. */
  async close(): Promise<void> {
    const child = this.child
    if (child === undefined) return
    if ([...this.pending.values()].some(operation => operation.input)) {
      child.stdin.end('{"action":"close"}\n')
    } else child.kill()
    await this.exited
    this.child = undefined
  }

  private async send(message: Record<string, unknown>, signal: AbortSignal, onKey?: (key: string) => void,
    onPoint?: (point: PointerSample) => void): Promise<void> {
    signal.throwIfAborted()
    const abort = () => {
      if (message.action === 'type' || message.action === 'key' || message.action === 'click' || message.action === 'drag') {
        this.child?.stdin.write('{"action":"cancel"}\n')
      } else this.child?.kill()
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      if (this.child === undefined) await this.start()
      signal.throwIfAborted()
      const id = ++this.nextId
      const done = Promise.withResolvers<void>()
      this.pending.set(id, { ...done, input: ['type', 'key', 'click', 'drag'].includes(String(message.action)),
        ...onKey === undefined ? {} : { onKey }, ...onPoint === undefined ? {} : { onPoint } })
      this.child?.stdin.write(JSON.stringify({ ...message, id }) + '\n', (error) => {
        if (error !== null && error !== undefined) { done.reject(error); this.pending.delete(id) }
      })
      await done.promise
    } catch (error) {
      await this.close()
      if (signal.aborted) signal.throwIfAborted()
      if (error instanceof ComputerError) throw error
      throw new ComputerError('OVERLAY_UNAVAILABLE', error instanceof Error ? error.message : String(error), 'possible',
        'Observe the target and check macOS Accessibility permission. Stop input if system input remains unavailable.')
    } finally { signal.removeEventListener('abort', abort) }
  }

  private start(): Promise<void> {
    const ready = Promise.withResolvers<void>()
    const child = this.child = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', overlayScript], { env: scrubbedParentEnv(), stdio: 'pipe' })
    // AppKit is serviced by the same thread that reads the private input pipe.
    const heartbeat = setInterval(() => {
      if (!child.stdin.destroyed && !child.stdin.writableEnded && !child.stdin.writableNeedDrain) child.stdin.write('{"action":"tick"}\n')
    }, 16)
    const lines = createInterface({ input: child.stdout })
    let diagnostic = ''
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { diagnostic = (diagnostic + chunk).slice(-2000) })
    const fail = (error: Error) => {
      ready.reject(error)
      for (const done of this.pending.values()) done.reject(error)
      this.pending.clear()
    }
    child.once('error', fail)
    child.stdin.on('error', (error) => { fail(error); child.kill() })
    lines.on('line', (line) => {
      const parsed = reply.safeParse(this.parse(line))
      if (!parsed.success) { fail(new Error('The macOS cursor display returned invalid JSON.')); child.kill(); return }
      if (parsed.data.error !== undefined) {
        fail(parsed.data.code === undefined ? new Error(parsed.data.error)
          : new ComputerError(parsed.data.code, parsed.data.error, 'possible',
            'Observe the exact target before continuing. Do not replay interrupted input automatically.'))
        child.kill(); return
      }
      if (parsed.data.ready) ready.resolve()
      if (parsed.data.id !== undefined) {
        const pending = this.pending.get(parsed.data.id)
        if (parsed.data.point !== undefined) pending?.onPoint?.(parsed.data.point)
        else if (parsed.data.key !== undefined) pending?.onKey?.(parsed.data.key)
        else { pending?.resolve(); this.pending.delete(parsed.data.id) }
      }
    })
    this.exited = new Promise(resolve => child.once('close', () => {
      clearInterval(heartbeat)
      lines.close()
      fail(new Error(diagnostic || 'The macOS cursor display stopped.'))
      resolve()
    }))
    return ready.promise
  }

  private parse(line: string): unknown {
    try { return JSON.parse(line) } catch (error) {
      // A malformed child response is rejected by the wire parser.
      if (error instanceof SyntaxError) return undefined
      throw error
    }
  }
}
