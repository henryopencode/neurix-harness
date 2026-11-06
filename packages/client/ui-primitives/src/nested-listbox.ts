/** Resolve a portaled selector back to the surface containing its trigger. */

/**
 * Recognize a child selector without treating its popup as part of an unrelated surface.
 * @param target - Pointer target or focused element.
 * @param containers - Trigger and surface elements owned by the caller.
 * @returns Whether a descendant trigger owns the target's portaled listbox.
 */
export function ownsPortaledListbox(target: EventTarget | null, containers: readonly (HTMLElement | null | undefined)[]): boolean {
  const popup = target instanceof Element ? target.closest('[role="listbox"][id]') : null
  if (popup === null || containers.some(container => container?.contains(popup))) return false
  return [...popup.ownerDocument.querySelectorAll('[aria-controls]')].some(trigger =>
    trigger.getAttribute('aria-controls')?.split(/\s+/u).includes(popup.id)
    && containers.some(container => container?.contains(trigger)))
}
