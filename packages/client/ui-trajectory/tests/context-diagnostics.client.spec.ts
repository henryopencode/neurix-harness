/** Diagnostics distinguish reported usage, unavailable evidence and route changes. */
import { describe, expect, it } from 'vitest'
import type { RequestView } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { deriveContextRequests, rankContextTools, sameContextRequests } from '../src/client/context-diagnostics.ts'

function request(startSeq: number, usage?: unknown, model = 'model-a'): Extract<RequestView, { purpose: 'assistant' }> {
  return {
    purpose: 'assistant', startSeq, turn: 1, step: startSeq,
    startedAt: startSeq, completedAt: startSeq + 1, status: 'complete',
    requestConfig: { provider: 'provider-a', model },
    ...(usage === undefined ? {} : { usage }),
  }
}

describe('context request diagnostics', () => {
  it('counts disjoint cache buckets in prompt size and compares adjacent requests on one route', () => {
    const [first, second] = deriveContextRequests([
      request(1, { inputTokens: 100, cacheReadTokens: 400, cacheWriteTokens: 100, outputTokens: 40 }),
      request(2, { inputTokens: 200, cacheReadTokens: 500, outputTokens: 60 }),
    ])
    expect(first).toMatchObject({ input: 600, output: 40, cacheRatio: 400 / 600 })
    expect(first?.delta).toBeUndefined()
    expect(second).toMatchObject({ input: 700, delta: 100, cacheRatio: 500 / 700 })
  })

  it('retains decreases and excludes auxiliary compaction calls from the ordinary request series', () => {
    const rows = deriveContextRequests([
      request(1, { inputTokens: 1_000, outputTokens: 1 }),
      { purpose: 'compaction', startSeq: 2, turn: 1, step: 0, startedAt: 2, completedAt: 3,
        status: 'complete', usage: { inputTokens: 9_000, outputTokens: 500 } },
      request(3, { inputTokens: 200, outputTokens: 1 }),
    ])
    expect(rows).toHaveLength(2)
    expect(rows[1]?.delta).toBe(-800)
    expect(rows[1]?.cacheRatio).toBeUndefined()
  })

  it('breaks comparisons on missing usage and provider or model switches', () => {
    const switchedProvider = { ...request(5, { inputTokens: 50, outputTokens: 1 }),
      providerMetadata: { provider: 'provider-b', model: 'model-a' } }
    const { requestConfig: _config, ...unknownRoute } = request(6, { inputTokens: 90, outputTokens: 1 })
    const rows = deriveContextRequests([
      request(1, { inputTokens: 100, outputTokens: 1 }),
      request(2),
      request(3, { inputTokens: 200, outputTokens: 1 }),
      request(4, { inputTokens: 300, outputTokens: 1 }, 'model-b'),
      switchedProvider,
      unknownRoute,
    ])
    expect(rows.every(row => row.delta === undefined)).toBe(true)
    expect(rows[1]?.input).toBeUndefined()
    expect(rows[4]).toMatchObject({ provider: 'provider-b', input: 50 })
  })

  it.each([
    null, 'unreported', {}, { inputTokens: -1 }, { inputTokens: Number.NaN },
    { inputTokens: 2.5 }, { inputTokens: 10, cacheReadTokens: '10' },
    { inputTokens: 10, cacheWriteTokens: -1 }, { inputTokens: Number.MAX_SAFE_INTEGER, cacheReadTokens: 1 },
  ])('does not invent prompt counts from invalid or absent usage: %j', (usage) => {
    expect(deriveContextRequests([request(1, usage)])[0]?.input).toBeUndefined()
  })

  it('distinguishes reported zero cache reads from an unreported cache metric', () => {
    const rows = deriveContextRequests([
      request(1, { inputTokens: 10, outputTokens: 0 }),
      request(2, { inputTokens: 10, cacheReadTokens: 0, outputTokens: 0 }),
      request(3, { inputTokens: 0, cacheReadTokens: 0, outputTokens: -1 }),
    ])
    expect(rows[0]?.cacheRatio).toBeUndefined()
    expect(rows[1]?.cacheRatio).toBe(0)
    expect(rows[2]).toMatchObject({ input: 0, delta: -10 })
    expect(rows[2]?.cacheRatio).toBeUndefined()
    expect(rows[2]?.output).toBeUndefined()
  })

  it('ignores request-object churn from streaming but observes changed request facts', () => {
    const original = request(1, { inputTokens: 100, outputTokens: 10 })
    expect(sameContextRequests([original], [{ ...original }])).toBe(true)
    expect(sameContextRequests([original], [])).toBe(false)
    for (const update of [{ usage: {} }, { status: 'running' as const }, { prompt: {
      config: { provider: 'a', model: 'b' }, system: '', tools: [],
    } }, { providerMetadata: { provider: 'b', model: 'c' } }]) {
      expect(sameContextRequests([original], [{ ...original, ...update }])).toBe(false)
    }
  })

  it('ranks complete tool definitions, including parameters, without changing catalog order', () => {
    const tools = [
      { name: 'small', description: '', parameters: { type: 'object' } },
      { name: 'large', description: '', parameters: { type: 'object', description: 'x'.repeat(2_000) } },
    ]
    expect(rankContextTools(undefined)).toEqual([])
    const ranked = rankContextTools({ config: { provider: 'a', model: 'b' }, system: '', tools })
    expect(ranked.map(row => row.tool.name)).toEqual(['large', 'small'])
    expect(ranked[0]?.tokens).toBeGreaterThan(500)
    expect(tools.map(tool => tool.name)).toEqual(['small', 'large'])
  })
})
