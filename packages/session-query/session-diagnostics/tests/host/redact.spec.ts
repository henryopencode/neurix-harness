/** Known credential formats are masked before local indexing and preview export. */
import { expect, it } from 'vitest'
import { redactDiagnostic } from '../../src/redact.ts'

it.each([
  ['Authorization: Bearer hidden-value', 'hidden-value'],
  ['token=hidden-value', 'hidden-value'],
  ['{"api_key":"hidden-value"}', 'hidden-value'],
  ['password: hidden-value', 'hidden-value'],
  ['Bearer hidden-value', 'hidden-value'],
  ['sk-abcdefghijklmnopqrstuvwx', 'abcdefghijklmnopqrstuvwx'],
  ['ghp_abcdefghijklmnopqrstuvwx', 'abcdefghijklmnopqrstuvwx'],
  ['https://alice:password@example.com/path?token=private&q=search', 'private'],
  ['/Users/alice/project/output.txt', 'alice'],
  ['C:\\Users\\alice\\project\\output.txt', 'alice'],
])('masks a recognized sensitive value in %s', (text, secret) => {
  const result = redactDiagnostic(text, 512)
  expect(result).not.toContain(secret)
  expect(result).not.toBe('')
})

it('retains useful error identity and bounds text including the truncation marker', () => {
  expect(redactDiagnostic('Error: required field is absent', 256)).toBe('Error: required field is absent')
  expect(redactDiagnostic('x'.repeat(1000), 256)).toHaveLength(256)
  expect(redactDiagnostic('x'.repeat(1000), 256)).toMatch(/…$/)
})

it('masks every URL query value and credential userinfo', () => {
  const result = redactDiagnostic('https://alice:hidden@example.com/a?key=one&next=two#fragment', 512)
  expect(result).not.toMatch(/alice|hidden|=one|=two/)
  expect(result).toContain('example.com/a')
})
