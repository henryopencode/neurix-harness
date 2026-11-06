// @vitest-environment jsdom
import { useRef, useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Menu } from '../src/Menu.tsx'
import { useDismissOnOutsidePointer } from '../src/useDismissOnOutsidePointer.ts'
import { Modal } from '../src/Modal.tsx'
import { closeTopModal } from '../src/useModalLayer.ts'
import { Select } from '../src/Select.tsx'

afterEach(cleanup)

function Field() {
  const [value, setValue] = useState('b')
  return <Select aria-label="Project" value={value} onValueChange={setValue}
    options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Closed', disabled: true }]} />
}

it('keeps keyboard focus on a selected option and returns it to the stable trigger', async () => {
  const { container } = render(<Field />)
  const trigger = screen.getByRole('combobox', { name: 'Project' })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  expect(screen.getByRole('listbox').parentElement).toBe(document.body)
  expect(container.querySelector('select')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Beta', selected: true }))
  fireEvent.keyDown(document.activeElement!, { key: 'a' })
  expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Alpha' }))
  fireEvent.click(document.activeElement!)
  await waitFor(() => { expect(document.activeElement).toBe(trigger) })
  expect(trigger).toHaveProperty('value', 'a')
  expect(trigger.textContent).toBe('Alpha')
  expect(screen.queryByRole('listbox')).toBeNull()
})

it('dismisses on Escape and outside press and never admits a disabled option', () => {
  render(<Field />)
  const trigger = screen.getByRole('combobox', { name: 'Project' })
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('option', { name: 'Closed' }))
  expect(trigger).toHaveProperty('value', 'b')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('listbox')).toBeNull()
  fireEvent.click(trigger)
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('listbox')).toBeNull()
  fireEvent.click(trigger)
  fireEvent.pointerDown(document)
  expect(screen.queryByRole('listbox')).toBeNull()
})

it('shows a retained unlisted value or the empty-field placeholder without inventing a selection', () => {
  const change = vi.fn()
  const view = render(<Select aria-label="Provider" value="custom-provider" options={[]}
    placeholder="Choose provider" onValueChange={change} />)
  const trigger = screen.getByRole('combobox', { name: 'Provider' })
  expect(trigger.textContent).toBe('custom-provider')
  fireEvent.keyDown(trigger, { key: 'a' })
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(change).not.toHaveBeenCalled()
  view.rerender(<Select aria-label="Provider" value="" options={[]} disabled
    placeholder="Choose provider" onValueChange={change} />)
  expect(trigger.textContent).toBe('Choose provider')
  fireEvent.click(trigger)
  expect(screen.queryByRole('listbox')).toBeNull()
})

it('keeps a portaled listbox in front of its modal for Tab and application close commands', async () => {
  const close = vi.fn()
  render(<Modal open title="Import" closeLabel="Close" onClose={close}><Field /></Modal>)
  fireEvent.click(screen.getByRole('combobox', { name: 'Project' }))
  closeTopModal(document)
  expect(close).not.toHaveBeenCalled()
  fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
  await waitFor(() => { expect(screen.queryByRole('listbox')).toBeNull() })
  expect(close).not.toHaveBeenCalled()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(close).toHaveBeenCalledOnce()
})

function NestedField({ menu }: { menu: boolean }) {
  const [open, setOpen] = useState(true)
  const root = useRef<HTMLDivElement>(null)
  useDismissOnOutsidePointer(root, open && !menu, setOpen)
  return menu ? <Menu open={open} anchor={<button>Open parent</button>} onClose={() => { setOpen(false) }}><Field /></Menu>
    : <div ref={root}>{open && <Field />}</div>
}

it.each([false, true])('keeps a child selector inside its parent surface when menu=%s', async (menu) => {
  render(<NestedField menu={menu} />)
  const trigger = screen.getByRole('combobox', { name: 'Project' })
  fireEvent.click(trigger)
  const option = screen.getByRole('option', { name: 'Alpha' })
  fireEvent.pointerDown(option)
  expect(screen.getByRole('combobox', { name: 'Project' })).toBe(trigger)
  fireEvent.click(option)
  await waitFor(() => { expect(trigger).toHaveProperty('value', 'a') })
  fireEvent.click(trigger)
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(screen.getByRole('combobox', { name: 'Project' })).toBe(trigger)
})
