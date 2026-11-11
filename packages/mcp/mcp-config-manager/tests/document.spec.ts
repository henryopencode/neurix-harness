/** Machine-wide edits preserve unrelated configuration, comments, and expressions. */
import { expect, it } from 'vitest'
import { declaration, editableRow, parsePatch, removeDeclaration, revision } from '../src/document.ts'

it('removes only the selected server and its overrides while retaining unrelated tagged configuration', () => {
  const document = parsePatch(`# personal configuration
- insert:
    - id: knowledge
      name: '@deepseek-ai/dsh-mcp-client'
      config: { serverName: knowledge, transport: stdio, command: ssh }
    - id: other
      name: '@fixture/other'
      config:
        path: !!js process.cwd()
        reference: { id: knowledge }
- id: knowledge
  disabled: true
`)
  expect(declaration(document, 'knowledge')).toBeDefined()
  expect(declaration(document, 'other')).toBeUndefined()
  removeDeclaration(document, 'knowledge')
  const output = String(document)
  expect(output.match(/id: knowledge/g)).toHaveLength(1)
  expect(output).toContain('reference: { id: knowledge }')
  expect(output).toContain('# personal configuration')
  expect(output).toContain('!!js process.cwd()')
  expect(output).toContain("'@fixture/other'")
})

it('rejects malformed patch data and invalidates revisions on external configuration edits', () => {
  expect(() => parsePatch('not: a patch')).toThrow()
  expect(() => parsePatch('- insert: [')).toThrow()
  expect(revision('[]\n', [])).not.toBe(revision('# edited\n[]\n', []))
})

it('updates an existing override without changing its declaration or unrelated flags', () => {
  const document = parsePatch(`- insert:
    - id: knowledge
      name: '@deepseek-ai/dsh-mcp-client'
      config: { serverName: knowledge, transport: stdio, command: original }
- id: knowledge
  disabled: true
`)
  const row = editableRow(document, 'knowledge')
  row?.set('config', { serverName: 'updated' })
  expect(row?.get('disabled')).toBe(true)
  expect(String(document)).toContain('command: original')
  expect(String(document)).toContain('serverName: updated')
  expect(editableRow(document, 'missing')).toBeUndefined()
})
