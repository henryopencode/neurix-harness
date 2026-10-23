/** Serialized native actions, independent pixel capture, and structured SDK refusals. @module */

import { z } from 'zod'
import { AsyncLocalStorage } from 'node:async_hooks'

const response = z.object({
  content: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string() }),
    z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() }),
  ])),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
  isError: z.boolean().optional(),
})

/** Canonical native result, validated at the SDK's JSON interface. */
export type NativeResult = z.infer<typeof response>

const actionResult = z.object({
  effect: z.enum(['confirmed', 'partial', 'unverifiable', 'suspected_noop', 'refused']),
  route: z.string(),
  delivery: z.object({ mode: z.string(), delivered_count: z.number().optional() }).optional(),
  evidence: z.array(z.object({ kind: z.string(), detail: z.string().optional() })).optional(),
  escalation: z.object({ target: z.string(), reason: z.string() }).optional(),
  summary: z.string().optional(),
  error: z.object({ code: z.string(), hint: z.string().optional() }).optional(),
})

/** Driver evidence about input delivery and its observed effect. */
export type NativeActionResult = z.infer<typeof actionResult>

/**
 * Read the driver's action evidence without treating delivery as a confirmed effect.
 * @param result - validated SDK envelope, or an action without an SDK result.
 * @returns validated action evidence when the driver supplies it.
 */
export function nativeActionResult(result: NativeResult | void): NativeActionResult | undefined {
  return result?.structuredContent?.effect === undefined ? undefined : actionResult.parse(result.structuredContent)
}

/** Failure with an operation's effect certainty and a safe recovery action. */
export class ComputerError extends Error {
  /**
   * @param code - stable failure discriminator.
   * @param message - task-relevant failure summary.
   * @param effect - whether input might already have reached its target.
   * @param nextAction - safe next operation for the caller.
   */
  constructor(readonly code: string, message: string, readonly effect: 'none' | 'possible' | 'completed', readonly nextAction: string) {
    super(message)
  }
}

/** One queue protects desktop input; display-only pixel captures do not acquire it. */
export class NativeCalls {
  private tail: Promise<void> = Promise.resolve()
  private previewInitialized = false
  private readonly scope = new AsyncLocalStorage<{ active: boolean; calls: Promise<void> }>()

  /**
   * @param driver - native runtime owned by the provider, never by an Agent.
   * @param timeoutMs - maximum elapsed time of one active native call.
   */
  constructor(private readonly driver: {
    callTool(name: string, argumentsJson: string, options: { signal: AbortSignal }): Promise<{ rawJson: string }>
  }, private readonly timeoutMs: number) {}

  /**
   * Run after earlier native work settles; a queued cancellation sends no input.
   * SDK abort errors retain the owning signal's timeout or cancellation reason.
   * @param name - upstream operation.
   * @param args - exact upstream arguments, including the owning lifecycle session.
   * @param signal - deadline, caller cancellation, and provider lifetime.
   * @param timeoutMs - deadline captured by a Session; omission uses the provider's initial setting.
   * @returns validated text, images, and structured fields, or a declared refusal.
   */
  call(name: string, args: Record<string, unknown>, signal: AbortSignal, timeoutMs = this.timeoutMs): Promise<NativeResult> {
    const reservation = this.scope.getStore()
    if (reservation?.active !== true) return this.exclusive(name, signal, () => this.call(name, args, signal, timeoutMs))
    const operation = reservation.calls.then(async () => {
      return this.invoke(name, args, signal, timeoutMs)
    })
    reservation.calls = operation.then(() => {}, () => {})
    return operation
  }

  /**
   * Capture pixels concurrently with input, without walking accessibility or changing actionable snapshots.
   * @param args - exact capture window, existing lifecycle session and image limit.
   * @param signal - preview lifetime and cancellation.
   * @param timeoutMs - deadline for this display-only read.
   * @returns an SDK image result; failure does not renew sessions or replay input.
   */
  async capture(args: { pid: number; window_id: number; session: string; max_dimension: number }, signal: AbortSignal,
    timeoutMs: number): Promise<NativeResult> {
    try {
      const result = await this.invoke('get_window_state', { ...args, include_accessibility_tree: false,
        include_screenshot: true, display_only: true }, signal, timeoutMs)
      this.previewInitialized = result.content.some(block => block.type === 'image')
      return result
    } catch (error) { this.previewInitialized = false; throw error }
  }

  /**
   * Report native preview readiness independently of actionable operations.
   * @returns true after a pixel capture completes, until the next capture failure.
   */
  get previewReady(): boolean { return this.previewInitialized }

  private async invoke(name: string, args: Record<string, unknown>, signal: AbortSignal, timeoutMs: number): Promise<NativeResult> {
    this.checkInterruption(name, signal, 'none')
    const active = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    let raw: { rawJson: string }
    try { raw = await this.driver.callTool(name, JSON.stringify(args), { signal: active }) } catch (error) {
      if (error instanceof ComputerError) throw error
      this.checkInterruption(name, active, 'possible')
      throw error
    }
    this.checkInterruption(name, active, 'possible')
    const result = response.parse(JSON.parse(raw.rawJson))
    const refusal = z.object({ code: z.string(), message: z.string() }).safeParse(result.structuredContent?.refusal)
    if (refusal.success) throw new ComputerError(refusal.data.code, refusal.data.message, 'none',
      'Observe the target and resolve the reported requirement before trying again.')
    const action = nativeActionResult(result)
    if (action?.effect === 'refused') throw new ComputerError(action.error?.code ?? 'DRIVER_REFUSED',
      action.error?.hint ?? action.summary ?? 'The driver refused input.', 'none',
      'Observe the target and resolve the reported requirement before trying again.')
    if (result.isError || result.structuredContent?.status === 'refused') throw new ComputerError('DRIVER_REFUSED',
      result.content.filter(block => block.type === 'text').map(block => block.text).join('\n'), 'possible',
      'Observe the target and resolve the reported requirement before trying again.')
    return result
  }

  /**
   * Serialize a complete desktop workflow, including observation and feedback.
   * Nested calls retain the reservation until the workflow settles.
   * @param name - operation reported when queued work is canceled.
   * @param signal - caller cancellation and deadline.
   * @param work - the complete sequence using this driver's call method.
   * @returns the sequence's result after earlier desktop work settles.
   */
  exclusive<T>(name: string, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    if (this.scope.getStore()?.active) return work()
    const operation = this.tail.then(() => {
      this.checkInterruption(name, signal, 'none')
      const reservation = { active: true, calls: Promise.resolve() }
      return this.scope.run(reservation, async () => {
        try { return await work() } finally { reservation.active = false }
      })
    })
    this.tail = operation.then(() => {}, () => {})
    return operation
  }

  private checkInterruption(name: string, signal: AbortSignal, effect: 'none' | 'possible'): void {
    if (!signal.aborted) return
    const reason: unknown = signal.reason
    const timeout = reason instanceof Error && reason.name === 'TimeoutError'
    throw new ComputerError(timeout ? 'TIMEOUT' : 'CANCELED',
      `${name}: ${reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'Computer input was canceled.'}`,
      effect, effect === 'none' ? 'No native input was dispatched. Start a new operation when ready.'
        : 'List targets and observe current state before continuing. Do not repeat the interrupted input automatically.')
  }
}
