/** External desktop fixture with observable values, input refusals, and shutdown. @module */

import type { NativeResult } from '../../src/native.ts'
import type { NativeElement } from '../../src/native-observation.ts'
import type { NativeDriver } from '../../src/native-driver.ts'

/** Valid PNG used only for screenshot admission checks. */
export const screenshotBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC'

/** Mutable state of the simulated external desktop. */
export const desktop = {
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  value: '', snapshots: 0, shutdowns: 0, destroys: 0,
  selected: false,
  elementsComplete: true,
  extraElements: [] as NativeElement[],
  windows: [{ pid: 9, window_id: 7, app_name: 'Fixture', title: 'Computer fixture', bounds: { x: 100, y: 100, width: 560, height: 320 } }] as Array<{ pid: number; window_id: number; app_name?: string; title?: string; bounds?: { x: number; y: number; width: number; height: number } }>,
  createError: undefined as Error | undefined,
  call: undefined as ((name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<NativeResult | undefined>) | undefined,
}

/** Restore only this fixture's owned state between cases. */
export function resetDesktop(): void {
  desktop.calls = []
  desktop.value = ''
  desktop.selected = false
  desktop.elementsComplete = true
  desktop.extraElements = []
  desktop.snapshots = 0
  desktop.shutdowns = 0
  desktop.destroys = 0
  desktop.windows = [{ pid: 9, window_id: 7, app_name: 'Fixture', title: 'Computer fixture', bounds: { x: 100, y: 100, width: 560, height: 320 } }]
  desktop.call = undefined
  desktop.createError = undefined
}

/** @returns the simulated external driver with awaited lifecycle cleanup. */
export function createNativeDriver(): NativeDriver {
  const driver = CuaDriver.create()
  return { callTool: (name, json, options) => driver.callTool(name, json, options), async close() {
    await driver.shutdown()
    driver.uniffiDestroy()
  } }
}

/** Native SDK fixture; browser behavior remains the real Playwright implementation. */
export class CuaDriver {
  /** @returns one fixture driver. */
  static create(): CuaDriver {
    if (desktop.createError !== undefined) throw desktop.createError
    return new CuaDriver()
  }

  /**
   * @param name - desktop operation.
   * @param json - validated upstream JSON arguments.
   * @param options - owning tool cancellation.
   * @returns raw SDK JSON with the external desktop result.
   */
  async callTool(name: string, json: string, options?: { signal: AbortSignal }): Promise<{ rawJson: string }> {
    const args = JSON.parse(json) as Record<string, unknown>
    desktop.calls.push({ name, args })
    if (desktop.call !== undefined) {
      const intercepted = await desktop.call(name, args, options?.signal)
      if (intercepted !== undefined) return { rawJson: JSON.stringify(intercepted) }
    }
    let result: NativeResult
    if (name === 'check_permissions') result = { content: [{ type: 'text', text: 'Accessibility granted; Screen Recording granted.' }], structuredContent: { accessibility: true, screen_recording: true } }
    else if (name === 'list_windows') result = { content: [{ type: 'text', text: 'One fixture window.' }], structuredContent: { windows: desktop.windows } }
    else if (name === 'launch_app') result = { content: [{ type: 'text', text: 'Application launched.' }], structuredContent: { bundle_id: args.bundle_id, launch_state: { requested: true, process_running: true, window_ready: desktop.windows.length > 0 }, windows: desktop.windows } }
    else if (name === 'get_window_state') {
      const snapshot = args.display_only === true ? desktop.snapshots : ++desktop.snapshots
      result = {
        content: [
          { type: 'text', text: `Text field: ${desktop.value}` },
          ...args.include_screenshot ? [{ type: 'image' as const, mimeType: 'image/png', data: screenshotBase64 }] : [],
        ],
        structuredContent: { snapshot_id: `s${snapshot.toString(16).padStart(8, '0')}`, window_bounds: desktop.windows[0]?.bounds,
          elements_complete: desktop.elementsComplete,
          screenshot_width: 1120, screenshot_height: 640,
          elements: [{ element_token: `field-${snapshot}`, role: 'AXTextField', value: desktop.value,
            frame: { x: 128, y: 220, w: 500, h: 36 } }, ...desktop.extraElements], tree_markdown: `Text field: ${desktop.value}` },
      }
    } else {
      if (name === 'hotkey' && JSON.stringify(args.keys) === '["cmd","a"]') desktop.selected = true
      if (name === 'type_text') { desktop.value = (desktop.selected ? '' : desktop.value) + String(args.text); desktop.selected = false }
      if (name === 'set_value') desktop.value = String(args.value)
      result = { content: [{ type: 'text', text: `${name} completed.` }], structuredContent: { status: 'completed' } }
    }
    return { rawJson: JSON.stringify(result) }
  }

  /** @returns after the fixture runtime stops. */
  shutdown(): Promise<void> { desktop.shutdowns++; return Promise.resolve() }
  /** Release the fixture's native binding. */
  uniffiDestroy(): void { desktop.destroys++ }
}
