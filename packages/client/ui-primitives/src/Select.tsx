/** Controlled single selection using the shared, viewport-aware menu surface. */
import { useId, useState, type ButtonHTMLAttributes } from 'react'
import clsx from 'clsx'
import { Menu } from './Menu.tsx'
import { IconChevronDownOutlineRegular } from './icons/index.tsx'
import css from './Select.module.css'

/** One localized choice in a single-value field. */
export interface SelectOption {
  readonly value: string
  readonly label: string
  readonly disabled?: boolean
}

/** Controlled selection and accessible button attributes supplied by the field owner. */
export interface SelectProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'onChange' | 'children'> {
  readonly value: string
  readonly options: readonly SelectOption[]
  readonly placeholder?: string
  readonly onValueChange: (value: string) => void
}

/**
 * Render a keyboard-accessible selector with a portaled list of localized choices.
 * @param props - Selected value, choices, field labels, and the staging callback.
 * @returns A stable trigger whose popup escapes clipping and fits the viewport.
 */
export function Select({ value, options, placeholder = '', onValueChange, className, disabled, ...button }: SelectProps) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const label = options.find(option => option.value === value)?.label ?? (value || placeholder)
  return <Menu open={open && !disabled} portal minWidthFromAnchor autoFocus
    className={css.root} listRole="listbox" listId={listId} selectedId={value}
    items={options.map(option => ({ id: option.value, label: option.label, disabled: option.disabled ?? false }))}
    onClose={() => { setOpen(false) }} onSelect={(next) => { onValueChange(next); setOpen(false) }}
    anchor={<button {...button} type="button" value={value} role="combobox" disabled={disabled}
      aria-haspopup="listbox" aria-expanded={open && !disabled} aria-controls={open ? listId : undefined}
      className={clsx(css.trigger, className)} onClick={() => { setOpen(previous => !previous) }}
      onKeyDown={(event) => {
        if (!open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); setOpen(true)
        }
      }}>
      <span className={css.value}>{label}</span><IconChevronDownOutlineRegular size={14} />
    </button>} />
}
