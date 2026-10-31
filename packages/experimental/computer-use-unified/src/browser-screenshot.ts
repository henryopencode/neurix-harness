/** Viewport capture independent of page fonts, animations, and load completion. @module */

import type { Page } from 'playwright'
import sharp from 'sharp'
import { z } from 'zod'
import type { BrowserDialogConnection } from './browser-dialog.ts'
import type { ScreenRect } from './feedback.ts'

/**
 * Crop native browser pixels to the measured web content without asking its renderer for another screenshot.
 * @param image - native window PNG, already bounded by the preview capture limit.
 * @param bounds - exact global window rectangle used for capture.
 * @param content - observed web-content rectangle in the same screen coordinates.
 * @returns PNG pixels covering the visible content intersection.
 * @throws when the image cannot be decoded or the content does not intersect its window.
 */
export async function cropBrowserPreview(image: Buffer, bounds: ScreenRect, content: ScreenRect): Promise<Buffer> {
  const metadata = await sharp(image).metadata()
  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new Error('The browser window capture has no usable dimensions.')
  }
  const x = metadata.width / bounds.width, y = metadata.height / bounds.height
  const left = Math.max(0, Math.round((content.x - bounds.x) * x))
  const top = Math.max(0, Math.round((content.y - bounds.y) * y))
  const right = Math.min(metadata.width, Math.round((content.x + content.width - bounds.x) * x))
  const bottom = Math.min(metadata.height, Math.round((content.y + content.height - bounds.y) * y))
  return sharp(image).extract({ left, top, width: right - left, height: bottom - top }).png().toBuffer()
}

const viewport = z.object({ result: z.object({ value: z.object({
  width: z.number().positive(), height: z.number().positive(),
}) }) })
const screenshot = z.object({ data: z.string() })
const message = z.object({ id: z.number().optional(), result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional() })
interface ScreenshotSession {
  send(method: 'Runtime.evaluate' | 'Page.captureScreenshot', params: Record<string, unknown>): Promise<unknown>
  detach(): Promise<void>
}

// Playwright's page-session detach first evaluates Runtime.runIfWaitingForDebugger,
// which waits behind native dialogs. Browser-level detach stays available during a modal.
async function dialogSafeSession(connection: BrowserDialogConnection): Promise<ScreenshotSession> {
  const { cdp, targetId } = connection
  const { sessionId } = z.object({ sessionId: z.string() }).parse(await cdp.send('Target.attachToTarget', { targetId, flatten: false }))
  const pending = new Map<number, PromiseWithResolvers<unknown>>()
  let serial = 0
  const receive = (event: { sessionId: string; message: string }) => {
    if (event.sessionId !== sessionId) return
    let parsed: z.infer<typeof message>
    try { parsed = message.parse(JSON.parse(event.message)) } catch (error) {
      // Reject owned reads; malformed protocol messages never escape the event callback.
      for (const request of pending.values()) request.reject(error)
      return
    }
    if (parsed.id === undefined) return
    const request = pending.get(parsed.id)
    if (parsed.error !== undefined) request?.reject(new Error(parsed.error.message))
    else request?.resolve(parsed.result)
  }
  cdp.on('Target.receivedMessageFromTarget', receive)
  return {
    async send(method, params) {
      const id = ++serial
      const request = Promise.withResolvers<unknown>()
      pending.set(id, request)
      try {
        await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) })
        return await request.promise
      } finally { pending.delete(id) }
    },
    async detach() {
      try { await cdp.send('Target.detachFromTarget', { sessionId }) } finally {
        cdp.off('Target.receivedMessageFromTarget', receive)
        for (const request of pending.values()) request.reject(new Error('Screenshot session detached.'))
      }
    },
  }
}

/**
 * Capture the visible viewport without waiting for web fonts. Decode and resize
 * on the Host to preserve CSS-pixel addressing without changing browser rendering.
 * Cancellation detaches only this observation's CDP session and awaits it;
 * the browser and its page remain open.
 * @param page - exact owned browser tab.
 * @param signal - owning operation cancellation and deadline.
 * @param timeoutMs - maximum elapsed time for the complete capture.
 * @param maxDimension - optional display-only long-edge limit in CSS pixels.
 * @param connection - preconnected browser identity for detach during native dialogs.
 * @returns the viewport PNG, or an explicit capture failure.
 */
export async function captureBrowserScreenshot(page: Page, signal: AbortSignal, timeoutMs: number, maxDimension?: number,
  connection?: BrowserDialogConnection): Promise<Buffer> {
  signal.throwIfAborted()
  const active = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
  const session = connection === undefined ? await page.context().newCDPSession(page) : await dialogSafeSession(connection)
  const disposal: { done?: Promise<void> } = {}
  const detach = () => disposal.done ??= session.detach()
  const abort = () => { void detach().catch(() => {}) }
  active.addEventListener('abort', abort, { once: true })
  try {
    active.throwIfAborted()
    const frame = viewport.parse(await session.send('Runtime.evaluate', {
      expression: '({ width: innerWidth, height: innerHeight })',
      returnByValue: true,
    })).result.value
    active.throwIfAborted()
    const image = screenshot.parse(await session.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false, fromSurface: true,
    }))
    active.throwIfAborted()
    const scale = maxDimension === undefined ? 1 : Math.min(1, maxDimension / Math.max(frame.width, frame.height))
    const png = await sharp(Buffer.from(image.data, 'base64')).resize({
      width: Math.max(1, Math.round(frame.width * scale)), height: Math.max(1, Math.round(frame.height * scale)),
      fit: 'inside', withoutEnlargement: true,
    }).png().toBuffer()
    active.throwIfAborted()
    return png
  } finally {
    active.removeEventListener('abort', abort)
    await detach()
  }
}
