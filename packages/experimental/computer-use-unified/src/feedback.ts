/** Display-only cursor and key feedback, Unicode pacing, and foreground input. @module */

import { setTimeout as delay } from 'node:timers/promises'
import { MacOverlay } from './overlay.ts'
import type { ResolvedConfig } from './index.ts'
import type { ComputerPreviewFrame } from './types.ts'

/** Global window rectangle in macOS screen points with a top-left origin. */
export interface ScreenRect { x: number; y: number; width: number; height: number }

/** Display-only input feedback shared by browser and native window adapters. */
export interface WindowFeedbackEvent {
  x?: number
  y?: number
  durationMs?: number
  idleMs: number
  click?: boolean
  pressed?: boolean
  typing?: boolean
  key?: string
  keys?: readonly string[]
  scroll?: 'up' | 'down' | 'left' | 'right'
  hold?: boolean
}

type Preview = Extract<ComputerPreviewFrame, { kind: 'frame' }>

/**
 * Render physical shortcut names as readable key labels.
 * @param keys - modifier and physical key names.
 * @returns shortcut labels with visible whitespace symbols.
 */
export function keyLabel(keys: readonly string[]): string {
  const names: Record<string, string> = { cmd: '⌘', command: '⌘', meta: '⌘', ctrl: '⌃', control: '⌃', shift: '⇧', alt: '⌥', option: '⌥',
    enter: '↵', return: '↵', escape: '⎋', tab: '⇥', backspace: '⌫', delete: '⌫', up: '↑', down: '↓', left: '←', right: '→',
    '\n': '↵', '\r': '↵', '\r\n': '↵', '\t': '⇥', ' ': '␣' }
  return keys.map(key => names[key.toLowerCase()] ?? key.toUpperCase()).join('  ')
}

/**
 * Display one delivered grapheme with its original case and Unicode composition.
 * @param character - current delivered grapheme.
 * @returns the original character or a visible whitespace symbol.
 */
export function characterLabel(character: string): string {
  const whitespace: Record<string, string> = { '\n': '↵', '\r': '↵', '\r\n': '↵', '\t': '⇥', ' ': '␣' }
  return whitespace[character] ?? character
}

/**
 * Insert complete graphemes in order, with cancellation between characters.
 * @param text - complete input text, retained only by the caller's input route.
 * @param delayMs - configured character interval.
 * @param write - exact target's Unicode insertion.
 * @param signal - owning operation deadline and cancellation.
 * @returns after the final insertion; interruption can leave partial text.
 */
export async function typeCharacters(
  text: string, delayMs: number, write: (character: string) => Promise<void>, signal: AbortSignal,
): Promise<void> {
  for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    signal.throwIfAborted()
    await write(part.segment)
    if (delayMs > 0) await delay(delayMs, undefined, { signal })
  }
}

/** A click-through marker ordered immediately above its own native target window. */
export class IndependentFeedback {
  private readonly overlay = new MacOverlay()
  private target: { owner: string; windowId: number; bounds: ScreenRect; capture: ScreenRect; visible: boolean } | undefined
  private motion: { from: { x: number; y: number }; to: { x: number; y: number }; at: number; duration: number } | undefined
  private until = 0
  private held = false
  private pressed = false
  private clickAt: number | undefined
  private keyboard: Preview['keyboard']
  private scrolling: Preview['scroll']

  /** @param config - Agent-captured display settings. */
  constructor(private readonly config: ResolvedConfig) {}

  /**
   * Select an exact window and screenshot rectangle without activating either.
   * @param owner - live tool target owning the display.
   * @param windowId - exact system window that receives the display overlay.
   * @param bounds - current native window rectangle.
   * @param capture - screen rectangle represented by its preview image.
   * @param visible - false for a browser tab hidden behind another tab.
   */
  select(owner: string, windowId: number, bounds: ScreenRect, capture = bounds, visible = true): void {
    if (this.target?.owner !== owner) {
      this.motion = undefined; this.keyboard = undefined; this.scrolling = undefined
      this.held = false; this.pressed = false; this.clickAt = undefined; this.until = 0
    }
    this.target = { owner, windowId, bounds, capture, visible }
  }

  /**
   * Initialize the foreground input worker before the target is activated.
   * @param signal - owning input lifetime.
   * @returns after its nonactivating AppKit host has selected the exact window.
   */
  async prepare(signal: AbortSignal): Promise<void> {
    if (this.target !== undefined) await this.overlay.select(this.target.windowId, this.target.bounds, signal)
  }

  /**
   * Await foreground activation in the same AppKit process that delivers input.
   * @param pid - process owning the selected exact window.
   * @param signal - operation deadline and cancellation.
   * @returns when AppKit reports the process active.
   */
  async activate(pid: number, signal: AbortSignal): Promise<void> {
    await this.overlay.activate(pid, signal)
  }

  /**
   * Verify an exact foreground window whose AX identity is unavailable.
   * @param pid - observed owning process.
   * @param windowId - observed CGWindowID, which must be the process's first visible normal window.
   * @param signal - operation deadline and cancellation.
   * @returns after the input worker confirms ownership and front ordering.
   */
  async verifyWindow(pid: number, windowId: number, signal: AbortSignal): Promise<void> {
    await this.overlay.verifyWindow(pid, windowId, signal)
  }

  /**
   * Project the same software cursor and keyboard state used by the desktop overlay.
   * @param owner - exact live target displayed by the preview.
   * @returns normalized cursor and transient indicators; expired feedback is absent.
   */
  preview(owner: string): Pick<Preview, 'cursor' | 'keyboard' | 'scroll'> & { active: boolean; action?: string } {
    const target = this.target
    if (target?.owner !== owner || !this.config.showOverlay || !this.held && !this.pressed && Date.now() > this.until) {
      return { active: false }
    }
    const point = this.position()
    return { active: true,
      ...point === undefined ? {} : { cursor: { x: (point.x - target.capture.x) / target.capture.width,
        y: (point.y - target.capture.y) / target.capture.height, ...this.pressed ? { pressed: true } : {},
        ...this.clickAt === undefined ? {} : { clickAt: this.clickAt } } },
      ...this.keyboard === undefined ? {} : { keyboard: this.keyboard },
      ...this.scrolling === undefined ? {} : { scroll: this.scrolling },
      action: this.keyboard?.kind === 'typing' ? 'type' : this.keyboard?.kind === 'shortcut' ? 'key'
        : this.scrolling !== undefined ? `scroll-${this.scrolling}` : this.clickAt !== undefined ? 'click' : 'move',
    }
  }

  /**
   * Render one adapter's event in the selected native overlay and shared preview state.
   * @param event - screen position or display-only feedback with at most the current key.
   * @param signal - owning input lifetime.
   * @returns after the display update; no operating-system input is generated.
   */
  async update(event: WindowFeedbackEvent, signal: AbortSignal): Promise<void> {
    const target = this.target
    if (target === undefined || !this.config.showOverlay) return
    if (event.x !== undefined && event.y !== undefined) {
      await this.move({ x: event.x, y: event.y }, target.windowId, target.bounds, signal, event.durationMs ?? 0)
    }
    this.held = event.hold === true
    this.until = Date.now() + event.idleMs
    if (event.pressed !== undefined) {
      this.pressed = event.pressed
      if (target.visible) await this.overlay.feedback({ pressed: event.pressed }, event.idleMs, signal)
    }
    if (event.click) await this.show('click', signal)
    else if (event.typing) await this.show('type', signal, event.hold, event.key)
    else if (event.keys !== undefined) await this.show(event.keys, signal)
    else if (event.scroll !== undefined) {
      this.scrolling = event.scroll
      if (target.visible) await this.overlay.feedback({ scroll: event.scroll, hold: event.hold === true }, event.idleMs, signal)
    }
  }

  /**
   * Animate the software cursor, optionally gliding the foreground system pointer too.
   * @param point - target point in global macOS coordinates.
   * @param windowId - exact background window under the marker.
   * @param bounds - current target window rectangle.
   * @param signal - owning operation deadline and cancellation.
   * @param durationMs - optional immediate placement before a new dialog's glide.
   * @param physical - glide the real pointer as well as feedback in foreground mode.
   * @returns after the display animation completes.
   */
  async move(point: { x: number; y: number }, windowId: number, bounds: ScreenRect, signal: AbortSignal,
    durationMs = this.config.cursorMoveDurationMs, physical = false): Promise<void> {
    if (!this.config.showOverlay && !physical) return
    this.motion = { from: this.position() ?? point, to: point, at: Date.now(), duration: durationMs }
    this.keyboard = undefined; this.scrolling = undefined; this.clickAt = undefined; this.held = false
    this.until = Date.now() + durationMs + this.config.overlayIdleMs
    if (this.target?.visible !== false) {
      const args = [point, durationMs, this.config.overlayIdleMs, signal, this.config.showOverlay, windowId, bounds] as const
      if (physical) await this.overlay.move(...args, true)
      else await this.overlay.move(...args)
    }
  }

  /**
   * Display an action without sending input or changing focus.
   * @param action - click, typing indicator, or shortcut names.
   * @param signal - owning operation deadline and cancellation.
   * @param hold - retain a paced typing indicator until the next move or cleanup.
   * @param key - current delivered key; omitted to retain the last typing key.
   * @returns after AppKit accepts the display update.
   */
  async show(action: 'click' | 'type' | readonly string[], signal: AbortSignal, hold = false, key?: string): Promise<void> {
    if (!this.config.showOverlay) return
    this.keyboard = action === 'type' ? key !== undefined ? { kind: 'typing', key }
      : this.keyboard?.kind === 'typing' ? this.keyboard : { kind: 'typing' } : action === 'click' ? undefined
      : { kind: 'shortcut', keys: action.map(key => keyLabel([key])) }
    this.clickAt = action === 'click' ? Date.now() : undefined
    this.scrolling = undefined; this.held = hold; this.until = Date.now() + this.config.overlayIdleMs
    if (this.target?.visible === false) return
    if (this.target !== undefined && this.motion === undefined) {
      await this.overlay.select(this.target.windowId, this.target.bounds, signal)
    }
    await this.overlay.feedback(action === 'click' ? { click: true }
      : action === 'type' ? { typing: true, ...this.keyboard?.kind === 'typing' && this.keyboard.key !== undefined
        ? { key: this.keyboard.key } : {}, ...hold ? { hold: true } : {} }
        : { label: keyLabel(action) }, this.config.overlayIdleMs, signal)
  }

  /**
   * Show a directional wheel indicator beside the independent native cursor.
   * @param direction - direction of the delivered window-scoped wheel input.
   * @param signal - owning operation deadline and cancellation.
   * @returns after AppKit accepts the display update.
   */
  async scroll(direction: 'up' | 'down' | 'left' | 'right', signal: AbortSignal): Promise<void> {
    if (!this.config.showOverlay) return
    this.scrolling = direction; this.keyboard = undefined; this.until = Date.now() + this.config.overlayIdleMs
    await this.overlay.feedback({ scroll: direction }, this.config.overlayIdleMs, signal)
  }

  /**
   * Type foreground Unicode key events; preview metadata contains only the current key.
   * @param pid - verified foreground target process.
   * @param text - requested insertion.
   * @param signal - owning input cancellation and deadline.
   * @returns after ordered key pairs and the configured final character interval.
   */
  async type(pid: number, text: string, signal: AbortSignal): Promise<void> {
    await this.overlay.type(pid, text, this.config.typingDelayMs, signal, (key) => { this.keyboard = { kind: 'typing', key } })
  }

  /**
   * Send a foreground chord through the ordered Unicode input worker.
   * @param pid - verified target process.
   * @param keys - normalized modifiers and key name.
   * @param signal - owning operation cancellation and deadline.
   * @returns after the key pair has been posted.
   */
  async key(pid: number, keys: readonly string[], signal: AbortSignal): Promise<void> {
    await this.overlay.key(pid, keys, signal)
  }

  /**
   * Deliver a physical click at the displayed screen point.
   * @param pid - verified foreground process.
   * @param point - global macOS screen points.
   * @param button - requested mouse button.
   * @param count - single or double click.
   * @param signal - owning input lifetime.
   * @returns after the complete click sequence has been posted.
   */
  async click(pid: number, point: { x: number; y: number }, button: 'left' | 'right', count: number, signal: AbortSignal): Promise<void> {
    await this.overlay.click(pid, point, button, count, signal)
  }

  /**
   * Drive a foreground drag and publish only positions emitted by its input worker.
   * @param pid - process owning the verified target window.
   * @param from - current global start point.
   * @param to - current global destination point.
   * @param signal - operation deadline and cancellation.
   * @returns after physical mouse-up, including cancellation cleanup.
   */
  async drag(pid: number, from: { x: number; y: number }, to: { x: number; y: number }, signal: AbortSignal): Promise<void> {
    this.motion = { from, to: from, at: Date.now(), duration: 0 }
    await this.overlay.drag(pid, from, to, this.config.cursorMoveDurationMs, this.config.overlayIdleMs, signal, (point) => {
      this.motion = { from: point, to: point, at: point.at, duration: 0 }
    })
  }

  /** Stop the owned marker and await its process exit. */
  async close(): Promise<void> {
    this.target = undefined; this.motion = undefined; this.keyboard = undefined; this.scrolling = undefined
    this.until = 0; this.held = false; this.pressed = false; this.clickAt = undefined
    await this.overlay.close()
  }

  private position(): { x: number; y: number } | undefined {
    const motion = this.motion
    if (motion === undefined) return undefined
    const progress = motion.duration === 0 ? 1 : Math.max(0, Math.min(1, (Date.now() - motion.at) / motion.duration))
    const eased = progress * progress * (3 - 2 * progress)
    return { x: motion.from.x + (motion.to.x - motion.from.x) * eased, y: motion.from.y + (motion.to.y - motion.from.y) * eased }
  }
}
