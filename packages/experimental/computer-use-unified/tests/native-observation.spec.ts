/** Native model observations preserve controls while removing duplicate driver diagnostics. */

import { expect, it } from 'vitest'
import { compactNativeState, nativeElementIdentity, nativeElementStateChanged } from '../src/native-observation.ts'

it('preserves action targeting, disabled state, hierarchy, exact text, and refusal details', () => {
  expect(compactNativeState({}).elements).toEqual([])
  const state = compactNativeState({ tree_markdown: 'Duplicated tree', _note: 'Driver diagnostics',
    degraded: true, degraded_reason: 'Exact AX window unavailable', escalation: { recommended: 'foreground' },
    elements: [{ element_token: 's1:2', element_index: 2, parent_index: 0, role: 'AXTextField', label: 'Message',
      value: ' 中文\n  ✅ ', enabled: false, selected: true, actions: ['AXPress'],
      frame: { x: 100, y: 200, w: 300, h: 40 }, screenshot_frame: { x: 0, y: 100, w: 600, h: 80 } }],
  })
  expect(state).not.toHaveProperty('tree_markdown')
  expect(state).not.toHaveProperty('_note')
  expect(state.elements[0]).not.toHaveProperty('frame')
  expect(state).toMatchObject({ degraded: true, degraded_reason: 'Exact AX window unavailable',
    escalation: { recommended: 'foreground' }, elements: [{ element_token: 's1:2', parent_index: 0,
      value: ' 中文\n  ✅ ', enabled: false, selected: true, screenshot_frame: { x: 0, y: 100, w: 600, h: 80 } }] })
})

it('matches visible controls independently of snapshot tokens, indices, and JSON key order', () => {
  const frame = { x: 10, y: 20, w: 100, h: 30 }
  const first = { element_token: 'old:1', element_index: 1, role: 'AXButton', label: 'Contact', frame }
  expect(nativeElementIdentity(first)).toBe(nativeElementIdentity({ frame, label: 'Contact', role: 'AXButton', element_token: 'new:2' }))
  expect(nativeElementIdentity(first)).not.toBe(nativeElementIdentity({ ...first, label: 'Other contact' }))
  expect(nativeElementIdentity({ role: 'AXButton', label: 'Invisible' })).toBeUndefined()
  expect(nativeElementIdentity({ frame: { ...frame, w: 0 }, role: 'AXButton' })).toBeUndefined()
  expect(nativeElementIdentity({ frame })).toBeUndefined()
})

it('requires a unique returned control with a changed value or selection', () => {
  const control = { role: 'AXCheckBox', label: 'Contacts', value: '0', selected: false, focused: false,
    frame: { x: 10, y: 20, w: 100, h: 30 } }
  const changed = { ...control, value: '1' }
  expect(nativeElementStateChanged(control, [changed])).toBe(true)
  expect(nativeElementStateChanged(control, [{ ...control, selected: true }])).toBe(true)
  for (const elements of [
    [], [control], [changed, changed], [{ ...changed, label: 'Messages' }],
    [{ ...changed, frame: { ...control.frame, x: 30 } }], [{ ...control, focused: true }],
    [{ ...control, value: undefined }], [{ ...control, value: 1 }],
  ]) expect(nativeElementStateChanged(control, elements)).toBe(false)
  expect(nativeElementStateChanged({ ...control, frame: null }, [changed])).toBe(false)
  expect(nativeElementStateChanged({ ...control, value: { count: 0 } }, [{ ...control, value: { count: 1 } }])).toBe(false)
})
