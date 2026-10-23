/** Native observations retain input geometry privately and expose concise model-facing controls. @module */

import { z } from 'zod'

const element = z.object({
  element_token: z.string().optional(),
  frame: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullish(),
}).loose()

/** SDK window fields needed for exact targeting and screenshot coordinates. */
export const nativeWindowState = z.object({
  background_input: z.object({ exact_window: z.object({ status: z.string() }).optional() }).optional(),
  snapshot_id: z.string().optional(),
  window_bounds: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }).nullish(),
  screenshot_width: z.number().positive().nullish(), screenshot_height: z.number().positive().nullish(),
  elements_complete: z.boolean().optional(),
  elements: z.array(element).optional(),
}).loose()

/** Exact observed native control, including private screen geometry. */
export type NativeElement = z.infer<typeof element>
/** Validated SDK observation before model-facing projection. */
export type NativeWindowState = z.infer<typeof nativeWindowState>

const elementFields = ['element_token', 'element_index', 'parent_index', 'role', 'label', 'value', 'enabled',
  'selected', 'focused', 'actions', 'screenshot_frame'] as const

/**
 * Preserve controls and refusal details while omitting duplicated trees and driver diagnostics.
 * @param state - validated SDK observation; original screen rectangles remain owned by the runtime.
 * @returns model-facing state with a mutable element list for the complete-result text budget.
 */
export function compactNativeState(state: NativeWindowState): NativeWindowState & { elements: NativeElement[] } {
  const { tree_markdown: _tree, _note, capture_id: _capture, invalidated_snapshot_ids: _invalidated,
    nodes_visited: _visited, timeout_ms: _timeout, walk_elapsed_ms: _elapsed,
    screenshot_mime_type: _mime, screenshot_scale: _scale, ...rest } = state
  return { ...rest, elements: (state.elements ?? []).map(item => Object.fromEntries(elementFields.flatMap(key =>
    item[key] === undefined ? [] : [[key, item[key]]]))) }
}

/**
 * Identify one visible control for read-only renewal of an expired element reference.
 * @param item - control from an exact-window observation.
 * @returns stable control fields and screen rectangle, or undefined for an unidentifiable control.
 */
export function nativeElementIdentity(item: NativeElement): string | undefined {
  return elementKey(item, ['role', 'label', 'value', 'frame', 'enabled', 'selected', 'focused', 'actions', 'identifier'])
}

/**
 * Check a returned control's value or selection without requiring unrelated controls to be present.
 * @param before - the exact visible control clicked in the previous observation.
 * @param elements - controls returned by the subsequent unfiltered observation.
 * @returns true when one matching control has a changed value or selection; missing or ambiguous controls return false.
 */
export function nativeElementStateChanged(before: NativeElement, elements: readonly NativeElement[]): boolean {
  const fields = ['role', 'label', 'frame', 'identifier'] as const
  const identity = elementKey(before, fields)
  if (identity === undefined) return false
  const matches = elements.filter(item => elementKey(item, fields) === identity)
  const current = matches.length === 1 ? matches[0] : undefined
  return current !== undefined && ['value', 'selected'].some((field) => {
    const value = before[field]
    return (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      && typeof current[field] === typeof value && current[field] !== value
  })
}

function elementKey(item: NativeElement, fields: readonly string[]): string | undefined {
  if (typeof item.role !== 'string' || item.frame == null || item.frame.w <= 0 || item.frame.h <= 0) return undefined
  return JSON.stringify(Object.fromEntries(fields.flatMap(key => item[key] === undefined ? [] : [[key, item[key]]])))
}
