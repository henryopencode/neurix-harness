/** Hardware selection avoids downloading checkpoints the current runtime cannot execute. */
import { expect, it } from 'vitest'
import { selectModel } from '../src/hardware.ts'

it('reserves memory for the recognizer and browser when selecting Breeze precision', () => {
  const mac = (gib: number) => ({ platform: 'darwin', architecture: 'arm64', memoryBytes: gib * 1024 ** 3 })
  expect(selectModel(mac(8), 'auto')).toBeNull()
  expect(selectModel(mac(12), 'auto')).toBe('mlx-4bit')
  expect(selectModel(mac(16), 'auto')).toBe('mlx-4bit')
  expect(selectModel(mac(32), 'auto')).toBe('mlx-8bit')
  expect(selectModel(mac(16), 'mlx-8bit')).toBeNull()
  expect(selectModel(mac(24), 'mlx-8bit')).toBe('mlx-8bit')
  expect(selectModel(mac(64), 'mlx-4bit')).toBe('mlx-4bit')
  for (const platform of ['linux', 'win32']) expect(selectModel({ ...mac(64), platform }, 'auto')).toBeNull()
  expect(selectModel({ ...mac(64), architecture: 'x64' }, 'auto')).toBeNull()
})
