/** Aspect-preserving preview geometry constrained to the usable viewport. @module */

/** Position and width selected by dragging the preview or its corners. */
export interface PreviewLayout {
  /** Left inset in CSS pixels. */
  x: number
  /** Top inset in CSS pixels. */
  y: number
  /** Image width in CSS pixels; the aspect ratio determines its height. */
  width: number
}

/** Browser dimensions and the minimum top inset, including desktop titlebar clearance. */
export interface PreviewViewport {
  /** Browser viewport width in CSS pixels. */
  width: number
  /** Browser viewport height in CSS pixels. */
  height: number
  /** Minimum top inset in CSS pixels. */
  top: number
}

/**
 * Keep the preview inside the viewport without changing its image proportions.
 * @param layout - requested position and width.
 * @param aspect - decoded image width divided by height.
 * @param viewport - usable browser dimensions and top inset.
 * @returns fitted dimensions; the original object when its values already fit.
 */
export function fitPreviewLayout(layout: PreviewLayout, aspect: number, viewport: PreviewViewport): PreviewLayout {
  const maximum = Math.max(1, Math.min(viewport.width - 32, (viewport.height - viewport.top - 16) * aspect))
  const width = Math.min(maximum, Math.max(Math.min(200, maximum), layout.width))
  const x = Math.max(16, Math.min(layout.x, viewport.width - width - 16))
  const y = Math.max(viewport.top, Math.min(layout.y, viewport.height - width / aspect - 16))
  return width === layout.width && x === layout.x && y === layout.y ? layout : { x, y, width }
}

/**
 * Resize from a bottom corner while keeping the opposite horizontal edge anchored when space permits.
 * @param start - position and width at pointer-down.
 * @param delta - horizontal and vertical pointer movement in CSS pixels.
 * @param edge - dragged corner's horizontal edge.
 * @param aspect - decoded image width divided by height.
 * @param viewport - browser dimensions and top inset.
 * @returns fitted dimensions with the image aspect ratio preserved.
 */
export function resizePreviewLayout(start: PreviewLayout, delta: { x: number; y: number }, edge: 'left' | 'right',
  aspect: number, viewport: PreviewViewport): PreviewLayout {
  const horizontal = edge === 'left' ? -delta.x : delta.x
  const vertical = delta.y * aspect
  const change = Math.abs(horizontal) >= Math.abs(vertical) ? horizontal : vertical
  const fitted = fitPreviewLayout({ ...start, width: start.width + change }, aspect, viewport)
  return fitPreviewLayout({ ...fitted, x: edge === 'left' ? start.x + start.width - fitted.width : start.x }, aspect, viewport)
}
