/** The Host namespace remains loadable for paired browser configuration discovery. */

import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import * as bundle from '../src/index.ts'

it('loads the Host namespace used to discover the bundle’s paired browser entry', async () => {
  const ctx = new Context()
  try {
    expect('default' in bundle).toBe(false)
    const fiber = await ctx.plugin(bundle).await()
    await fiber.dispose()
  } finally { await ctx.fiber.dispose() }
})
