/** Native preview crops preserve the measured web-content rectangle without renderer capture. */

import sharp from 'sharp'
import { expect, it } from 'vitest'
import { cropBrowserPreview } from '../src/browser-screenshot.ts'

it('removes native chrome at Retina scale and keeps only the measured content pixels', async () => {
  const content = await sharp({ create: { width: 200, height: 120, channels: 3, background: '#ff0000' } }).png().toBuffer()
  const image = await sharp({ create: { width: 200, height: 140, channels: 3, background: '#0000ff' } })
    .composite([{ input: content, left: 0, top: 16 }]).png().toBuffer()
  const cropped = await cropBrowserPreview(image, { x: 100, y: 200, width: 100, height: 70 },
    { x: 100, y: 208, width: 100, height: 60 })
  expect(await sharp(cropped).metadata()).toMatchObject({ width: 200, height: 120 })
  expect((await sharp(cropped).stats()).channels.slice(0, 3).map(channel => channel.mean)).toEqual([255, 0, 0])
})

it('reports unusable window dimensions or a content rectangle outside its image', async () => {
  const image = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer()
  await expect(cropBrowserPreview(image, { x: 0, y: 0, width: 0, height: 10 }, { x: 0, y: 0, width: 10, height: 10 }))
    .rejects.toThrow('no usable dimensions')
  await expect(cropBrowserPreview(image, { x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 5, height: 5 }))
    .rejects.toThrow()
})
