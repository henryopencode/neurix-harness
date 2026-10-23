/** Model arguments for session-owned browser and macOS operations. @module */

import { z } from 'zod'

const target = z.string().min(1).describe('Required window or tab id returned by list/observe. Send target separately from ref, locator, or coordinates; a native ref identifies an element inside this target. List again after resuming.')
const screenshot = z.boolean().optional().describe('Include a screenshot; native capture needs Screen Recording permission.')
const query = z.string().optional().describe('Literal substring: list filters targets; native observe filters accessibility text. Omit for a full read. Never put an operation description here.')
const locator = z.discriminatedUnion('by', [
  z.object({ by: z.literal('role'), role: z.enum(['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'option', 'tab', 'menuitem', 'heading', 'searchbox', 'switch', 'slider', 'spinbutton']), name: z.string(), exact: z.boolean().default(true) }),
  z.object({ by: z.literal('label'), text: z.string(), exact: z.boolean().default(true) }),
  z.object({ by: z.literal('text'), text: z.string(), exact: z.boolean().default(true) }),
  z.object({ by: z.literal('css'), selector: z.string().min(1) }),
]).describe('Browser element from the latest page observation. Ambiguous matches fail.')
const address = {
  ref: z.string().min(1).optional().describe('Native element_token from the latest observation of this exact window. Native background click and type require target plus ref on every call; their pixel routes can activate the application and are unavailable in background mode.'),
  locator: locator.optional(),
  x: z.number().nonnegative().optional().describe('Screenshot-pixel X. Native click/type coordinates require foreground input; browser coordinates remain available in background.'),
  y: z.number().nonnegative().optional().describe('Screenshot-pixel Y, supplied together with x. Native background click/type must use ref.'),
}

/** Validated operations; native input always names one exact window. */
export const computerInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), query }),
  z.object({ action: z.literal('open_app'), bundleId: z.string().min(1).describe('Required for open_app: macOS bundle identifier, for example com.apple.TextEdit. Use {"action":"open_app","bundleId":"com.apple.TextEdit"}.') }),
  z.object({ action: z.literal('open_browser'), url: z.string().optional(), screenshot }),
  z.object({ action: z.literal('new_tab'), target, url: z.string().optional(), screenshot }),
  z.object({ action: z.literal('observe'), target, screenshot, query }),
  z.object({ action: z.literal('navigate'), target, url: z.string(), screenshot }),
  z.object({ action: z.literal('move'), target, ...address, screenshot }),
  z.object({ action: z.literal('click'), target, ...address, button: z.enum(['left', 'right']).default('left'), count: z.number().int().min(1).max(2).default(1), screenshot }),
  z.object({ action: z.literal('type'), target, ...address, text: z.string(), replace: z.boolean().default(false), screenshot }),
  z.object({ action: z.literal('key'), target, keys: z.array(z.string().min(1)).min(1), screenshot }),
  z.object({ action: z.literal('scroll'), target, ...address, direction: z.enum(['up', 'down', 'left', 'right']), amount: z.number().positive().max(100_000).describe('Scroll distance in CSS pixels for browser tabs; native windows use wheel notches (1–50).'), screenshot }),
  z.object({ action: z.literal('drag'), target, ...address,
    toLocator: locator.optional().describe('Observed browser drop target; resolves its current geometry before mouse-down.'),
    toPosition: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).default({ x: 0.5, y: 0.5 })
      .describe('Fraction within toLocator: center is x:0.5,y:0.5; use y:0.2 to insert above a sortable card.'),
    toX: z.number().nonnegative().optional(), toY: z.number().nonnegative().optional(), screenshot }),
  z.object({ action: z.literal('menu'), target, path: z.array(z.string().min(1)).min(1), screenshot }),
  z.object({ action: z.literal('dialog'), target, accept: z.boolean(), text: z.string().optional(), screenshot }),
  z.object({ action: z.literal('close_tab'), target }),
  z.object({ action: z.literal('reset') }),
])

const modelLocator = z.object({
  by: z.enum(['role', 'label', 'text', 'css']),
  role: locator.options[0].shape.role.optional(),
  name: z.string().optional(), text: z.string().optional(), selector: z.string().optional(),
  exact: z.boolean().optional(),
}).optional().describe('Browser locator: role needs role and name; label/text need text; css needs selector.')

const modelFields: Record<string, z.ZodType> = {}
for (const option of computerInput.options) {
  const { action: _action, ...fields } = option.shape
  for (const [name, field] of Object.entries<z.ZodType>(fields)) modelFields[name] = field.optional()
}

/**
 * Model-facing object with explicit properties for providers that require an
 * object root. The executor validates each action's required fields separately.
 */
export const computerParameters = z.object({
  ...modelFields,
  action: z.enum(computerInput.options.map(option => option.shape.action.value))
    .describe('Required operation. list/reset need no other fields; open_app requires bundleId. All other actions except open_browser require target. type requires text; key requires keys; navigate requires url; scroll requires direction and amount; drag prefers locator and toLocator from geometry.elements, or x,y,toX,toY in actual screenshot pixels; menu requires path; dialog requires accept. click/scroll need an observed element or screenshot point. type uses an observed editor, or the verified focused browser editor; foreground native type may continue in the focused editor without another address.'),
  locator: modelLocator,
  toLocator: modelLocator.describe('Browser drag destination from the latest observed geometry.elements. Prefer this over guessed screenshot coordinates.'),
})

/** Arguments after tool JSON validation and explicit per-operation defaults. */
export type ComputerInput = z.infer<typeof computerInput>
