/** Visible editable fields and their exact observed selectors. @module */

import type { Page } from 'playwright'
import { z } from 'zod'

const fields = z.array(z.object({
  tag: z.string(), placeholder: z.string(), label: z.string(), focused: z.boolean(),
  value: z.string(), valueTruncated: z.boolean(),
  locator: z.object({ by: z.literal('css'), selector: z.string() }).optional(),
}))

/**
 * Describe visible editors without reading hidden controls or password values.
 * Exact selectors are returned only for unique DOM ids; focused editors may
 * receive a subsequent type call without another locator.
 * @param page - owned tab being observed.
 * @param limit - configured maximum number of returned fields.
 * @param maxValueChars - aggregate character budget for exact visible editor values.
 * @returns validated editable-field metadata from the page's current DOM.
 */
export async function observeBrowserFields(page: Pick<Page, 'evaluate'>, limit: number, maxValueChars: number): Promise<z.infer<typeof fields>> {
  return fields.parse(await page.evaluate(`(() => {
    let remaining = ${maxValueChars};
    const editors = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));
    return editors.filter(element => {
      const bounds = element.getBoundingClientRect();
      const type = (element.getAttribute('type') || 'text').toLowerCase();
      const style = getComputedStyle(element);
      return bounds.width > 0 && bounds.height > 0 && !element.disabled && !element.readOnly
        && bounds.right > 0 && bounds.bottom > 0 && bounds.left < innerWidth && bounds.top < innerHeight
        && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.display !== 'none'
        && !element.closest('[hidden], [inert], [aria-hidden="true"]')
        && !['hidden', 'password', 'checkbox', 'radio', 'submit', 'button', 'reset', 'file', 'range', 'color'].includes(type);
    }).slice(0, ${limit}).map(element => {
      const selector = element.id ? '#' + CSS.escape(element.id) : undefined;
      const original = element.value === undefined ? element.innerText : element.value;
      const value = original.slice(0, remaining);
      remaining -= value.length;
      return { tag: element.tagName.toLowerCase(), placeholder: element.getAttribute('placeholder') || '',
        label: element.getAttribute('aria-label') || '',
        value, valueTruncated: value.length !== original.length,
        focused: element === document.activeElement || element.contains(document.activeElement),
        ...(selector && document.querySelectorAll(selector).length === 1 ? { locator: { by: 'css', selector } } : {}) };
    });
  })()`))
}
