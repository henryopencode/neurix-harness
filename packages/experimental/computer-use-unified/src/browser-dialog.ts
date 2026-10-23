/** Exact native geometry for an owned Chromium page's JavaScript dialog. @module */

import type { CDPSession, Dialog, Page } from 'playwright'
import { z } from 'zod'
import type { ResolvedConfig } from './index.ts'
import { ComputerError, type NativeResult } from './native.ts'
import type { ScreenRect } from './feedback.ts'
import { resolveBrowserHost } from './browser-window.ts'

const elements = z.object({ elements: z.array(z.object({
  element_token: z.string(), element_index: z.number().int(), parent_index: z.number().int().optional(),
  role: z.string(), label: z.string().optional(), value: z.unknown().optional(), enabled: z.boolean().optional(),
  frame: z.object({ x: z.number(), y: z.number(), w: z.number().nonnegative(), h: z.number().nonnegative() }).nullish(),
})) })
type Element = z.infer<typeof elements>['elements'][number]
type Control = Element & { frame: NonNullable<Element['frame']> }

/** A verified native window and the actual controls belonging to its dialog. */
export interface BrowserDialogWindow {
  pid: number
  windowId: number
  bounds: ScreenRect
  captureWindowId: number
  captureBounds: ScreenRect
  anchor: Control
  accept: Control
  cancel?: Control
  field?: Control
}

type ReadNative = (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<NativeResult>

/** Browser connection prepared before page JavaScript can open a modal dialog. */
export interface BrowserDialogConnection {
  cdp: CDPSession
  pid: number
  targetId: string
}

/**
 * Read a tab's protocol identity before navigation or input opens a modal dialog.
 * @param page - newly owned tab.
 * @param cdp - browser-owned connection, released with the browser.
 * @returns process and target identity for future browser-level window reads.
 */
export async function connectBrowserDialog(page: Page, cdp: CDPSession): Promise<BrowserDialogConnection> {
  const tab = await page.context().newCDPSession(page)
  try {
    const processes = z.object({ processInfo: z.array(z.object({ type: z.string(), id: z.number().int() })) })
      .parse(await cdp.send('SystemInfo.getProcessInfo')).processInfo.filter(process => process.type === 'browser')
    const info = z.object({ targetInfo: z.object({ targetId: z.string() }) }).parse(await tab.send('Target.getTargetInfo'))
    if (processes.length !== 1 || processes[0] === undefined) throw unavailable()
    return { cdp, pid: processes[0].id, targetId: info.targetInfo.targetId }
  } finally { await tab.detach() }
}

function unavailable(): ComputerError {
  return new ComputerError('DIALOG_FEEDBACK_UNAVAILABLE', 'The native dialog controls could not be uniquely matched to this browser tab.',
    'none', 'Observe the same tab and check macOS Accessibility permission. No dialog input was sent.')
}

function contains(outer: ScreenRect, inner: ScreenRect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height
}

/**
 * Bind the owned browser process and CDP window to real AX dialog controls.
 * Both embedded dialogs and separate dialog windows contained by their host are supported.
 * Missing or ambiguous controls fail before input; coordinates are never inferred.
 * @param connection - exact owned tab identity prepared before the dialog opened.
 * @param dialog - current Playwright dialog, whose message must match AX.
 * @param read - serialized, Session-owned native observation.
 * @param config - observation budgets.
 * @param signal - owning operation lifetime.
 * @returns current native window bounds and observed controls.
 */
export async function resolveBrowserDialog(
  connection: BrowserDialogConnection, dialog: Dialog, read: ReadNative, config: ResolvedConfig, signal: AbortSignal,
): Promise<BrowserDialogWindow> {
  let resolved: Awaited<ReturnType<typeof resolveBrowserHost>>
  try { resolved = await resolveBrowserHost(connection, read, signal) } catch (error) {
    if (error instanceof ComputerError && error.code === 'WINDOW_FEEDBACK_UNAVAILABLE') throw unavailable()
    throw error
  }
  const { pid, host, bounds, windows } = resolved
  const matches: BrowserDialogWindow[] = []
  for (const window of windows) {
    const at = window.bounds
    if (at === undefined || !contains(bounds, at)) continue
    const result = await read('get_window_state', { pid, window_id: window.window_id, include_screenshot: false,
      tree_format: 'elements', full_output: true, max_elements: config.maxElements, max_depth: config.maxDepth,
      timeout_ms: config.nativeTreeTimeoutMs }, signal)
    const tree = elements.parse(result.structuredContent).elements
    const messages = [...new Map(tree.filter(element => (element.role === 'AXStaticText' || element.role === 'AXTextField')
      && dialog.message().length > 0 && (element.label === dialog.message() || element.value === dialog.message()))
      .map(element => [element.parent_index, element])).values()]
    for (const message of messages) {
      const siblings = tree.filter((element): element is Control => element.parent_index === message.parent_index
        && element.enabled !== false && element.frame != null && element.frame.w > 0 && element.frame.h > 0 && contains(at, {
        x: element.frame.x, y: element.frame.y, width: element.frame.w, height: element.frame.h,
      }))
      const accept = siblings.filter(element => element.role === 'AXButton' && /^(OK|确定|確定|确认|確認)$/iu.test(element.label ?? ''))
      const cancel = siblings.filter(element => element.role === 'AXButton' && /^(Cancel|取消)$/iu.test(element.label ?? ''))
      const fields = siblings.filter(element => element.role === 'AXTextField')
      if (message.frame == null || accept.length !== 1 || accept[0] === undefined || (dialog.type() !== 'alert' && cancel.length !== 1)
        || (dialog.type() === 'prompt' && fields.length !== 1)) continue
      matches.push({ pid, windowId: window.window_id, bounds: at,
        captureWindowId: host.window_id, captureBounds: bounds, anchor: { ...message, frame: message.frame }, accept: accept[0],
        ...cancel[0] === undefined ? {} : { cancel: cancel[0] },
        ...dialog.type() !== 'prompt' || fields[0] === undefined ? {} : { field: fields[0] } })
    }
  }
  // Chrome exposes a sheet's controls in both its host AX tree and its own window.
  const controls = new Set(matches.map(match => JSON.stringify([
    match.anchor.frame, match.accept.frame, match.cancel?.frame, match.field?.frame,
  ])))
  if (controls.size !== 1) throw unavailable()
  const ordered = matches.sort((left, right) => left.bounds.width * left.bounds.height - right.bounds.width * right.bounds.height)
  const selected = ordered[0]
  if (selected === undefined || ordered[1] !== undefined
    && ordered[1].bounds.width * ordered[1].bounds.height === selected.bounds.width * selected.bounds.height) throw unavailable()
  return selected
}
