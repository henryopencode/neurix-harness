/** Project-scoped Markdown memory with immutable image copies and revision-checked writes. */

import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const IMAGE_SECTION = '\n<!-- document-memory:images -->\n'
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const ASSET = /^assets\/[a-f0-9]{64}\.(?:png|jpg|webp|gif)$/u
const MAX_DOCUMENT_BYTES = 1024 * 1024

class MemoryError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.code = code
    this.details = details
  }
}

function fail(code, message, details) {
  throw new MemoryError(code, message, details)
}

function text(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0 || /[\r\n]/u.test(value)) {
    fail('INVALID_INPUT', `${field} must be a non-empty single-line string`)
  }
  return value.trim()
}

function record(value, field) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('INVALID_INPUT', `${field} must be a JSON object`)
  }
  return value
}

function identifier(value) {
  if (typeof value !== 'string' || value.length > 64 || !ID.test(value)) {
    fail('INVALID_INPUT', 'id must contain 1–64 lowercase ASCII letters, digits, and single hyphens')
  }
  return value
}

function tags(value) {
  if (!Array.isArray(value)) fail('INVALID_INPUT', 'tags must be an array of strings')
  return [...new Set(value.map(tag => text(tag, 'tag')))]
}

function status(value) {
  if (value !== 'active' && value !== 'archived') fail('INVALID_INPUT', 'status must be active or archived')
  return value
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function missing(error) {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
}

function regularFile(path) {
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink()) fail('INVALID_DOCUMENT', `Expected a regular file: ${path}`)
  return info
}

function directory(path) {
  const info = lstatSync(path)
  if (!info.isDirectory() || info.isSymbolicLink()) fail('INVALID_DOCUMENT', `Expected a directory without a symbolic link: ${path}`)
}

function defaultRoot() {
  const cwd = resolve(process.cwd())
  let candidate = cwd
  while (true) {
    if (existsSync(join(candidate, '.git'))) return join(candidate, '.dsh', 'memory')
    const parent = dirname(candidate)
    if (parent === candidate) return join(cwd, '.dsh', 'memory')
    candidate = parent
  }
}

function canonicalRoot(path) {
  const absent = []
  let existing = resolve(path)
  while (!existsSync(existing)) {
    absent.unshift(basename(existing))
    existing = dirname(existing)
  }
  return join(realpathSync(existing), ...absent)
}

function readDocument(root, id) {
  const path = join(root, 'documents', `${identifier(id)}.md`)
  try {
    if (regularFile(path).size > MAX_DOCUMENT_BYTES) fail('INVALID_DOCUMENT', `Memory document exceeds ${MAX_DOCUMENT_BYTES} bytes: ${path}`)
  } catch (error) {
    if (missing(error)) fail('NOT_FOUND', `No memory document ${id}`, { path })
    throw error
  }
  const raw = readFileSync(path, 'utf8')
  const header = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(raw)
  try {
    if (header === null) fail('INVALID_DOCUMENT', `Missing JSON frontmatter: ${path}`)
    const metadata = record(JSON.parse(header[1]), 'frontmatter')
    if (metadata.format !== 1 || metadata.id !== id) fail('INVALID_DOCUMENT', `Unexpected memory format or id: ${path}`)
    text(metadata.title, 'title')
    text(metadata.summary, 'summary')
    tags(metadata.tags)
    status(metadata.status)
    if (typeof metadata.updatedAt !== 'string' || new Date(metadata.updatedAt).toISOString() !== metadata.updatedAt) {
      fail('INVALID_DOCUMENT', `Invalid updatedAt: ${path}`)
    }
    if (!Array.isArray(metadata.images)) fail('INVALID_DOCUMENT', `Invalid image list: ${path}`)
    const images = metadata.images.map((entry) => {
      const image = record(entry, 'image')
      if (typeof image.path !== 'string' || !ASSET.test(image.path)) fail('INVALID_DOCUMENT', `Invalid image path: ${path}`)
      text(image.caption, 'caption')
      const absolutePath = join(root, image.path)
      regularFile(absolutePath)
      return { path: image.path, caption: image.caption, absolutePath }
    })
    const content = raw.slice(header[0].length).trimStart()
    const boundary = content.indexOf(IMAGE_SECTION)
    if (boundary < 0) fail('INVALID_DOCUMENT', `Missing generated image-section marker: ${path}`)
    return {
      id, title: metadata.title, summary: metadata.summary, tags: metadata.tags,
      status: metadata.status, updatedAt: metadata.updatedAt, images,
      root, path, revision: digest(raw), body: content.slice(0, boundary).trimEnd(),
    }
  } catch (error) {
    if (error instanceof MemoryError && error.code === 'INVALID_DOCUMENT') throw error
    fail('INVALID_DOCUMENT', `Cannot read memory document ${path}: ${error instanceof Error ? error.message : String(error)}`, { path })
  }
}

function documents(root) {
  if (!existsSync(root)) return []
  directory(root)
  if (existsSync(join(root, 'assets'))) directory(join(root, 'assets'))
  const docs = join(root, 'documents')
  if (!existsSync(docs)) return []
  directory(docs)
  return readdirSync(docs).filter(file => file.endsWith('.md')).sort().map((file) => {
    const id = file.slice(0, -3)
    identifier(id)
    return readDocument(root, id)
  })
}

function atomicWrite(path, content) {
  const temporary = join(dirname(path), `.memory-${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, content, { flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function escapeMarkdown(value) {
  return value.replace(/[\\`*_[\]<>|]/gu, '\\$&')
}

function reindex(root) {
  const all = documents(root)
  const lines = ['# Memory documents', '', 'Generated from documents/*.md. Search and read documents with dsh-memory-documents.', '']
  for (const state of ['active', 'archived']) {
    const selected = all.filter(doc => doc.status === state)
    lines.push(`## ${state === 'active' ? 'Active' : 'Archived'}`, '')
    if (selected.length === 0) lines.push('No documents.', '')
    for (const doc of selected) {
      lines.push(`- [${escapeMarkdown(doc.title)}](documents/${doc.id}.md): ${escapeMarkdown(doc.summary)}`)
      if (doc.tags.length > 0) lines.push(`  Tags: ${doc.tags.map(escapeMarkdown).join(', ')}`)
    }
    if (selected.length > 0) lines.push('')
  }
  atomicWrite(join(root, 'INDEX.md'), lines.join('\n'))
  return { root, indexPath: join(root, 'INDEX.md'), documents: all.length }
}

function withWriteLock(root, action) {
  mkdirSync(root, { recursive: true })
  directory(root)
  const lock = join(root, '.write.lock')
  let descriptor
  try {
    descriptor = openSync(lock, 'wx')
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      fail('BUSY', `A memory writer holds ${lock}. Check its recorded process; remove a leftover lock only after confirming that writer is no longer running.`, { lock })
    }
    throw error
  }
  try {
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n')
    for (const name of ['documents', 'assets']) {
      const path = join(root, name)
      if (!existsSync(path)) mkdirSync(path)
      directory(path)
    }
    return action()
  } finally {
    closeSync(descriptor)
    rmSync(lock)
  }
}

function imageExtension(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg'
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'gif'
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp'
  fail('INVALID_IMAGE', 'Image bytes must have a PNG, JPEG, WebP, or GIF signature')
}

function saveImage(root, input, maxBytes) {
  const image = record(input, 'image')
  const source = text(image.source, 'image.source')
  const caption = text(image.caption, 'image.caption')
  if (!isAbsolute(source)) fail('INVALID_INPUT', 'image.source must be an absolute file path')
  const info = regularFile(source)
  if (info.size > maxBytes) fail('IMAGE_TOO_LARGE', `${source} exceeds the ${maxBytes}-byte image limit`)
  const bytes = readFileSync(source)
  if (bytes.length > maxBytes) fail('IMAGE_TOO_LARGE', `${source} exceeds the ${maxBytes}-byte image limit`)
  const extension = imageExtension(bytes)
  const hash = digest(bytes)
  const path = `assets/${hash}.${extension}`
  const destination = join(root, path)
  if (existsSync(destination)) {
    regularFile(destination)
    if (digest(readFileSync(destination)) !== hash) fail('INVALID_IMAGE', `Stored asset content does not match its filename: ${destination}`)
  } else {
    atomicWrite(destination, bytes)
  }
  return { path, caption }
}

function put(root, input, maxImageBytes) {
  const value = record(input, 'input')
  const id = identifier(value.id)
  const title = text(value.title, 'title')
  const summary = text(value.summary, 'summary')
  const topicTags = tags(value.tags)
  const state = status(value.status ?? 'active')
  if (typeof value.body !== 'string' || value.body.trim().length === 0 || value.body.includes('<!-- document-memory:images -->')) {
    fail('INVALID_INPUT', 'body must be non-empty Markdown without the generated image-section marker')
  }
  if (!Array.isArray(value.images)) fail('INVALID_INPUT', 'images must be an array; use [] for a text-only document')
  return withWriteLock(root, () => {
    const destination = join(root, 'documents', `${id}.md`)
    let current
    try {
      current = readDocument(root, id)
    } catch (error) {
      if (!(error instanceof MemoryError) || error.code !== 'NOT_FOUND') throw error
    }
    if (current === undefined ? value.expectedRevision !== undefined : value.expectedRevision !== current.revision) {
      fail('REVISION_CONFLICT', `Read ${id} again and supply its current revision before updating it`, { id, currentRevision: current?.revision ?? null })
    }
    const images = value.images.map(image => saveImage(root, image, maxImageBytes))
    const metadata = {
      format: 1, id, title, summary, tags: topicTags, status: state,
      updatedAt: new Date().toISOString(), images,
    }
    const imageLines = images.length === 0 ? '' : '\n## Images\n\n' + images.map(image => `![${escapeMarkdown(image.caption)}](../${image.path})`).join('\n\n') + '\n'
    const source = `---\n${JSON.stringify(metadata, null, 2)}\n---\n\n${value.body.trim()}\n${IMAGE_SECTION}${imageLines}`.trimEnd() + '\n'
    if (Buffer.byteLength(source) > MAX_DOCUMENT_BYTES) fail('INVALID_INPUT', `Complete Markdown document exceeds ${MAX_DOCUMENT_BYTES} bytes`)
    // Validate the rest of the store before publishing a document whose index could not be rebuilt.
    documents(root)
    atomicWrite(destination, source)
    try {
      reindex(root)
    } catch (error) {
      fail('INDEX_UPDATE_FAILED', `Document ${id} is committed, but its index could not be refreshed. Repair the cause and run reindex.`, {
        committed: true, path: destination,
        cause: error instanceof Error ? error.message : String(error),
      })
    }
    return readDocument(root, id)
  })
}

function search(root, query, limit, includeArchived) {
  const terms = [...new Set(query.trim().toLowerCase().split(/\s+/u).filter(Boolean))]
  const matches = documents(root).filter(doc => includeArchived || doc.status === 'active').flatMap((doc) => {
    const fields = [
      [doc.title, 5], [doc.summary, 3], [doc.tags.join(' '), 4],
      [doc.images.map(image => image.caption).join(' '), 2], [doc.body, 1],
    ].map(([content, weight]) => [content.toLowerCase(), weight])
    if (!terms.every(term => fields.some(([content]) => content.includes(term)))) return []
    const score = terms.reduce((total, term) => total + fields.reduce((weight, [content, boost]) => weight + (content.includes(term) ? boost : 0), 0), 0)
    const { body: _body, ...summary } = doc
    return [{ ...summary, score }]
  }).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id, 'en'))
  return { root, total: matches.length, results: matches.slice(0, limit) }
}

function positiveInteger(value, field) {
  if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value))) fail('INVALID_INPUT', `${field} must be a positive safe integer`)
  return Number(value)
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      root: { type: 'string' }, id: { type: 'string' }, query: { type: 'string', default: '' },
      limit: { type: 'string', default: '10' }, 'include-archived': { type: 'boolean', default: false },
      'max-image-bytes': { type: 'string', default: String(20 * 1024 * 1024) },
    },
  })
  if (positionals.length !== 1) fail('INVALID_INPUT', 'Expected one command: init, put, search, get, or reindex')
  if (values.root !== undefined && !isAbsolute(values.root)) fail('INVALID_INPUT', '--root must be an absolute directory')
  const root = canonicalRoot(values.root ?? defaultRoot())
  switch (positionals[0]) {
    case 'init':
    case 'reindex': return withWriteLock(root, () => reindex(root))
    case 'put': {
      const input = readFileSync(0, 'utf8')
      if (Buffer.byteLength(input) > MAX_DOCUMENT_BYTES) fail('INVALID_INPUT', `Input JSON exceeds ${MAX_DOCUMENT_BYTES} bytes`)
      let parsed
      try {
        parsed = JSON.parse(input)
      } catch (error) {
        fail('INVALID_INPUT', `Expected valid JSON on standard input: ${error instanceof Error ? error.message : String(error)}`)
      }
      return put(root, parsed, positiveInteger(values['max-image-bytes'], '--max-image-bytes'))
    }
    case 'search': return search(root, values.query, positiveInteger(values.limit, '--limit'), values['include-archived'])
    case 'get':
      if (existsSync(root)) directory(root)
      if (existsSync(join(root, 'documents'))) directory(join(root, 'documents'))
      if (existsSync(join(root, 'assets'))) directory(join(root, 'assets'))
      return readDocument(root, identifier(values.id))
    default: fail('INVALID_INPUT', `Unknown memory command: ${positionals[0]}`)
  }
}

try {
  process.stdout.write(JSON.stringify(main()) + '\n')
} catch (error) {
  const expected = error instanceof MemoryError
  process.stderr.write(JSON.stringify({ error: {
    code: expected ? error.code : 'IO_ERROR',
    message: error instanceof Error ? error.message : String(error),
    ...(expected ? error.details : { outcome: 'unknown', nextAction: 'Read the current document before deciding whether to retry.' }),
  } }) + '\n')
  process.exitCode = 1
}
