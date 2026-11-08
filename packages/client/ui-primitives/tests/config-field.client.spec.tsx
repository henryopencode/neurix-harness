// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConfigField, type ConfigFieldProps } from '../src/ConfigField.tsx'

afterEach(cleanup)

it('shares controlled inputs and reset actions between generated and custom forms', () => {
  const props: ConfigFieldProps = {
    label: 'Timeout', value: '500', secret: false, choices: [], disabled: false,
    overridden: true, invalid: false,
    labels: { reset: 'Reset', inherited: 'Inherited', invalid: 'Invalid value' },
    onChange: vi.fn(), onReset: vi.fn(),
  }
  const view = render(<ConfigField {...props} />)
  fireEvent.change(screen.getByLabelText('Timeout'), { target: { value: '600' } })
  expect(props.onChange).toHaveBeenCalledWith('600')
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
  expect(props.onReset).toHaveBeenCalledOnce()
  view.rerender(<ConfigField {...props} choices={['500', '600']} invalid />)
  expect(screen.getByRole('status').textContent).toBe('Invalid value')
  chooseOption(screen.getByRole('combobox'), '')
  chooseOption(screen.getByRole('combobox'), '600')
  expect(props.onReset).toHaveBeenCalledTimes(2)
  expect(props.onChange).toHaveBeenCalledTimes(2)
  view.rerender(<ConfigField {...props} secret overridden={false} />)
  expect(screen.getByLabelText('Timeout').getAttribute('type')).toBe('password')
  fireEvent.change(screen.getByLabelText('Timeout'), { target: { value: 'hidden' } })
  expect(props.onChange).toHaveBeenLastCalledWith('hidden')
  expect(screen.queryByRole('button')).toBeNull()
  view.rerender(<ConfigField {...props} secret disabled overridden={false} />)
  expect(screen.getByLabelText('Timeout').hasAttribute('disabled')).toBe(true)
})

function chooseOption(control: HTMLElement, value: string): void {
  fireEvent.click(control)
  const option = screen.getAllByRole<HTMLButtonElement>('option').find(item => item.value === value)
  if (option === undefined) throw new Error(`Missing option: ${value}`)
  fireEvent.click(option)
}
