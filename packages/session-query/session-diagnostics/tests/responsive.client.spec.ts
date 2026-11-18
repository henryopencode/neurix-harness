/** Consumer-local declarations; real viewport behavior is covered by the Web flow. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/Diagnostics.module.css', import.meta.url)), 'utf8')

describe('diagnostics search input', () => {
  it('raises the coarse-pointer floor without changing fine-pointer input sizing', () => {
    const coarse = /@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\}\s*\}/.exec(css)
    expect(coarse?.[1]).toMatch(/\.search\s+input\s*\{\s*font-size:\s*16px;/)
    expect(css.replace(coarse?.[0] ?? '', '')).not.toMatch(/\.search\s+input\s*\{/)
  })
})
