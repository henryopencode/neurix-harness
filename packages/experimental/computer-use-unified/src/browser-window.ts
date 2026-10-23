/** Native window and content rectangles for an owned Chromium page. @module */

import type { Page } from 'playwright'
import { z } from 'zod'
import type { BrowserDialogConnection } from './browser-dialog.ts'
import type { ResolvedConfig } from './index.ts'
import { ComputerError, type NativeResult } from './native.ts'
import type { ScreenRect } from './feedback.ts'

/** System window inventory validated at the native driver's JSON interface. */
export const nativeWindows = z.object({ windows: z.array(z.object({
  pid: z.number().int(), window_id: z.number().int(), title: z.string().optional(), app_name: z.string().optional(),
  is_on_screen: z.boolean().nullish(), on_current_space: z.boolean().nullish(),
  bounds: z.object({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() }).optional(),
})) })

type ReadNative = (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<NativeResult>
type NativeWindow = z.infer<typeof nativeWindows>['windows'][number]

/**
 * Bind the browser's process and rectangle, or its sole window, to a system window.
 * @param connection - prepared owned browser identity.
 * @param read - serialized native reader.
 * @param signal - operation lifetime.
 * @returns actual system bounds and process-scoped windows; ambiguity rejects before input.
 */
export async function resolveBrowserHost(connection: BrowserDialogConnection, read: ReadNative, signal: AbortSignal): Promise<{
  pid: number
  host: NativeWindow
  bounds: ScreenRect
  windows: NativeWindow[]
}> {
  const { cdp, pid, targetId } = connection
  const result = z.object({ bounds: z.object({
    left: z.number(), top: z.number(), width: z.number().positive(), height: z.number().positive(),
  }) }).parse(await cdp.send('Browser.getWindowForTarget', { targetId })).bounds
  const bounds: ScreenRect = { x: result.left, y: result.top, width: result.width, height: result.height }
  signal.throwIfAborted()
  const owned = nativeWindows.parse((await read('list_windows', { pid, on_screen_only: false }, signal)).structuredContent).windows
    .filter(window => window.pid === pid)
  const windows = owned.filter(window => window.bounds !== undefined)
  const hosts = windows.filter(window => window.bounds !== undefined
    && (['x', 'y', 'width', 'height'] as const).every(key => window.bounds?.[key] === bounds[key]))
  const host = hosts.length === 1 ? hosts[0] : hosts.length === 0 && owned.length === 1 ? windows[0] : undefined
  if (host?.bounds === undefined) throw new ComputerError('WINDOW_FEEDBACK_UNAVAILABLE',
    'The owned browser window could not be matched to one system window.', 'none',
    'Observe the same target and check native window access before continuing.')
  return { pid, host, bounds: host.bounds, windows }
}

/**
 * Read the actual native web-content rectangle without assuming toolbar dimensions.
 * @param connection - exact owned browser identity.
 * @param page - exact page receiving background input.
 * @param read - serialized native reader.
 * @param config - native observation budgets.
 * @param signal - operation lifetime.
 * @returns native window, content rectangle and measured CSS viewport; hidden tabs suppress desktop feedback.
 */
export async function resolveBrowserViewport(connection: BrowserDialogConnection, page: Page, read: ReadNative,
  config: ResolvedConfig, signal: AbortSignal): Promise<{
  pid: number
  windowId: number
  bounds: ScreenRect
  viewport: { width: number; height: number; visible: boolean }
  scaleX: number
  scaleY: number
  desktopVisible: boolean
  content: ScreenRect
}> {
  const { pid, host, bounds } = await resolveBrowserHost(connection, read, signal)
  const native = await read('get_window_state', { pid, window_id: host.window_id,
    include_screenshot: config.inputMode === 'foreground', max_dimension: config.maxScreenshotDimension,
    tree_format: 'elements', max_elements: config.maxElements, max_depth: config.maxDepth, timeout_ms: config.nativeTreeTimeoutMs }, signal)
  const state = z.object({ screenshot_width: z.number().positive().nullish(), screenshot_height: z.number().positive().nullish(),
    elements: z.array(z.object({ role: z.string(), depth: z.number(),
      frame: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullish(),
    })) }).parse(native.structuredContent)
  const elements = state.elements
  const areas = elements.filter(element => element.role === 'AXWebArea' && element.frame != null
    && element.frame.w > 0 && element.frame.h > 0).sort((left, right) => left.depth - right.depth)
  const area = areas[0]?.frame
  if (area == null || areas[1]?.depth === areas[0]?.depth) throw new ComputerError('WINDOW_FEEDBACK_UNAVAILABLE',
    'The browser content rectangle could not be read from system accessibility.', 'none',
    'Observe the same browser target and check Accessibility access. No input was sent.')
  const viewport = z.object({ width: z.number().positive(), height: z.number().positive(), visible: z.boolean() })
    .parse(await page.evaluate('({ width: innerWidth, height: innerHeight, visible: document.visibilityState === "visible" })'))
  return { pid, windowId: host.window_id, bounds, viewport,
    scaleX: (state.screenshot_width ?? bounds.width) / bounds.width,
    scaleY: (state.screenshot_height ?? bounds.height) / bounds.height,
    desktopVisible: host.is_on_screen !== false && host.on_current_space !== false && viewport.visible,
    content: { x: area.x, y: area.y, width: area.w, height: area.h } }
}
