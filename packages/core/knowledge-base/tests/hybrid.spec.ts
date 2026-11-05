import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { KnowledgeIndex } from '../src/engine.ts'
import { resolveConfig } from '../src/config.ts'
import type { KnowledgeSpace } from '../src/types.ts'

it('uses the configured LangChain embedding provider with native LanceDB hybrid retrieval', async () => {
  const requests: string[] = []
  const pending = new Set<Promise<void>>()
  async function respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body = ''
    for await (const chunk of request) body += String(chunk)
    const data = z.object({ input: z.array(z.string()), model: z.string() }).parse(JSON.parse(body))
    requests.push(data.model)
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ model: data.model, embeddings: data.input.map(text => text.includes('苹果') || text.includes('apple') ? [1, 0, 0] : [0, 1, 0]) }))
  }
  const server = createServer((request, response) => {
    const operation = respond(request, response)
    pending.add(operation)
    void operation.then(() => { pending.delete(operation) }, (error: unknown) => {
      pending.delete(operation)
      response.statusCode = 500
      response.end(String(error))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected an ephemeral TCP address')
  const path = await mkdtemp(join(tmpdir(), 'knowledge-hybrid-'))
  const index = new KnowledgeIndex(resolveConfig({ path, embedding: { baseUrl: `http://127.0.0.1:${address.port}`, model: 'fixture-embedding' } }))
  try {
    await index.open()
    const space = brandString<KnowledgeSpace>('fruit-reference')
    const signal = new AbortController().signal
    await index.import(space, async () => ({ source: '/reference/fruit.txt', bytes: new TextEncoder().encode('apple orchard') }), signal)
    const result = await index.search(space, '苹果', 1, signal)
    expect(result.mode).toBe('hybrid')
    expect(result.passages[0]?.text).toBe('apple orchard')
    expect(requests).toEqual(['fixture-embedding', 'fixture-embedding'])
  } finally {
    await index.close()
    server.closeAllConnections()
    await Promise.allSettled(pending)
    await new Promise<void>((resolve, reject) => server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    }))
    await rm(path, { recursive: true, force: true })
  }
})

it('awaits an in-flight source read during disposal and prevents late document publication', async () => {
  const path = await mkdtemp(join(tmpdir(), 'knowledge-drain-'))
  const config = resolveConfig({ path })
  const index = new KnowledgeIndex(config)
  const space = brandString<KnowledgeSpace>('drain-test')
  let begin!: () => void
  let release!: () => void
  const started = new Promise<void>((resolve) => { begin = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  try {
    await index.open()
    const importing = index.import(space, async () => {
      begin()
      await gate
      return { source: '/reference/late.txt', bytes: new TextEncoder().encode('late document') }
    }, new AbortController().signal)
    await started
    const closing = index.close()
    await expect(index.list(space, 0, 1, new AbortController().signal)).rejects.toMatchObject({ code: 'KNOWLEDGE_CLOSED' })
    release()
    await expect(importing).rejects.toMatchObject({ code: 'KNOWLEDGE_CLOSED' })
    await closing
    const reopened = new KnowledgeIndex(config)
    try {
      await reopened.open()
      expect((await reopened.list(space, 0, 1, new AbortController().signal)).documents).toEqual([])
    } finally { await reopened.close() }
  } finally {
    release()
    await index.close()
    await rm(path, { recursive: true, force: true })
  }
})
