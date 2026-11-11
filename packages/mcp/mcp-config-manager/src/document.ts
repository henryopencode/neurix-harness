/** Comment-preserving edits to machine-wide MCP declarations. @module */
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isMap, isSeq, parseDocument, visit, type Document, type YAMLMap } from 'yaml'
import type {} from './types.ts'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

/** Read an absent patch as an empty sequence; other file failures propagate.
 * @param path - machine-wide patch file.
 * @returns exact file contents, or an empty YAML sequence.
 */
export async function readPatch(path: string): Promise<string> {
  try { return await readFile(path, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return '[]\n'
  }
}

/** Parse the Loader YAML dialect without evaluating expressions.
 * @param text - existing patch document.
 * @returns editable YAML preserving comments and JavaScript tags.
 */
export function parsePatch(text: string): Document {
  const document = parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }] })
  if (document.errors.length || !isSeq(document.contents)) throw new RemoteError('mcp/invalid-document', 'Repair the global patch file before editing MCP servers', {})
  document.contents.flow = false
  return document
}

/** Find a declaration inserted by this file, excluding override patches.
 * @param document - parsed global patch.
 * @param id - unqualified Loader row id.
 * @returns the owned declaration, when present.
 */
export function declaration(document: Document, id: string): YAMLMap | undefined {
  let found: YAMLMap | undefined
  visit(document, { Map(_key, node, path) {
    if (node.get('id') !== id || node.get('name') !== '@deepseek-ai/dsh-mcp-client') return
    if (path.some(parent => isMap(parent) && parent.has('insert'))) found = node
  } })
  return found
}

/** Find the last global override, otherwise the declaration owned by this file.
 * @param document - parsed global patch.
 * @param id - unqualified Loader row id.
 * @returns a row that can be updated without appending another override.
 */
export function editableRow(document: Document, id: string): YAMLMap | undefined {
  if (!isSeq(document.contents)) return undefined
  const row = document.contents.items.findLast(item => isMap(item) && item.get('id') === id && !item.has('insert')
    && (!item.has('name') || item.get('name') === '@deepseek-ai/dsh-mcp-client'))
  return isMap(row) ? row : declaration(document, id)
}

/** Remove an owned declaration and its overrides, preserving other rows.
 * @param document - parsed global patch.
 * @param id - unqualified Loader row id.
 */
export function removeDeclaration(document: Document, id: string): void {
  const owned = declaration(document, id)
  visit(document, { Map(_key, node) {
    if (node === owned) return visit.REMOVE
  } })
  if (!isSeq(document.contents)) return
  for (let index = document.contents.items.length - 1; index >= 0; index--) {
    const row = document.contents.items[index]
    if (isMap(row) && row.get('id') === id && !row.has('insert')
      && (!row.has('name') || row.get('name') === '@deepseek-ai/dsh-mcp-client')) document.delete(index)
  }
}

/** Configuration-only optimistic revision; connection changes do not invalidate edits.
 * @param text - current global patch.
 * @param configuration - effective Loader configuration.
 * @returns revision used to reject stale Client writes.
 */
export function revision(text: string, configuration: readonly object[]): string {
  return createHash('sha256').update(text).update(JSON.stringify(configuration)).digest('hex')
}
