/** Preview resizing preserves image proportions and keeps both corners inside the viewport. */

import { expect, it } from 'vitest'
import { fitPreviewLayout, resizePreviewLayout } from '../src/client/preview-layout.ts'

const viewport = { width: 1440, height: 1000, top: 64 }
const start = { x: 1056, y: 88, width: 320 }

it('keeps the opposite edge anchored while expanding the left corner', () => {
  const resized = resizePreviewLayout(start, { x: -160, y: 100 }, 'left', 1.6, viewport)
  expect(resized).toEqual({ x: 896, y: 88, width: 480 })
  expect(resized.x + resized.width).toBe(start.x + start.width)
})

it('uses vertical movement for a taller corner gesture and enforces the minimum size', () => {
  expect(resizePreviewLayout(start, { x: 1, y: 100 }, 'right', 1.6, viewport).width).toBe(480)
  expect(resizePreviewLayout(start, { x: -1000, y: -1000 }, 'right', 1.6, viewport).width).toBe(200)
})

it.each([0.5, 1.6, 3])('fits a resized image of aspect %s inside a narrow viewport', (aspect) => {
  const screen = { width: 390, height: 600, top: 96 }
  const result = fitPreviewLayout({ x: 1200, y: 900, width: 1000 }, aspect, screen)
  expect(result.x).toBeGreaterThanOrEqual(16)
  expect(result.y).toBeGreaterThanOrEqual(screen.top)
  expect(result.x + result.width).toBeLessThanOrEqual(screen.width - 16)
  expect(result.y + result.width / aspect).toBeLessThanOrEqual(screen.height - 16)
})

it('retains a fitted layout without replacing its identity', () => {
  expect(fitPreviewLayout(start, 1.6, viewport)).toBe(start)
})
