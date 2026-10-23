/** Rendered browser controls and viewport geometry for observed input. @module */

import type { Page } from 'playwright'
import { z } from 'zod'

const geometry = z.object({
  viewport: z.object({ width: z.number().positive(), height: z.number().positive(), scrollX: z.number(), scrollY: z.number() }),
  elements: z.array(z.object({
    tag: z.string(), label: z.string(), inViewport: z.boolean(),
    locator: z.object({ by: z.literal('css'), selector: z.string() }),
    bounds: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }),
  })),
})

/**
 * Read rendered element rectangles without inspecting hidden application state.
 * Coordinates use viewport CSS pixels, matching browser screenshots and input.
 * @param page - exact owned browser page.
 * @param limit - maximum number of rendered elements to include, including offscreen controls.
 * @returns validated viewport dimensions, exact locators, and current rectangles.
 */
export async function observeBrowserGeometry(page: Pick<Page, 'evaluate'>, limit: number): Promise<z.infer<typeof geometry>> {
  return geometry.parse(await page.evaluate(`(() => {
    const geometryElements = Array.from(document.querySelectorAll('[id], button, a[href], input, textarea, select, [contenteditable="true"], [role], [draggable="true"]'));
    const visible = [], offscreen = [];
    const exactSelector = element => {
      let current = element;
      const parts = [];
      while (current && current !== document.documentElement) {
        const id = current.id ? '#' + CSS.escape(current.id) : undefined;
        if (id && document.querySelectorAll(id).length === 1) { parts.unshift(id); break; }
        const tag = current.tagName.toLowerCase();
        const siblings = current.parentElement ? Array.from(current.parentElement.children).filter(node => node.tagName === current.tagName) : [];
        parts.unshift(tag + ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')');
        current = current.parentElement;
      }
      if (current === document.documentElement) parts.unshift('html');
      const selector = parts.join(' > ');
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === element ? selector : undefined;
    };
    for (const element of geometryElements) {
      if (visible.length >= ${limit}) break;
      if (element.closest('[aria-hidden="true"], [hidden], [inert]')) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0
        || rect.width <= 0 || rect.height <= 0) continue;
      const inViewport = rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
      if (!inViewport && offscreen.length >= ${limit}) continue;
      const selector = exactSelector(element);
      const button = element.tagName === 'BUTTON' || element.getAttribute('role') === 'button';
      const label = element.getAttribute('aria-label') || (button ? element.textContent.trim() : element.tagName.toLowerCase());
      const locator = selector ? { by: 'css', selector } : undefined;
      if (!locator) continue;
      (inViewport ? visible : offscreen).push({ tag: element.tagName.toLowerCase(), label, locator, inViewport,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
    }
    const elements = visible.concat(offscreen).slice(0, ${limit});
    return { viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY }, elements };
  })()`))
}
