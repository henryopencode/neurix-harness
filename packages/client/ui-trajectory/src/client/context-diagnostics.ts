/** Context diagnostics from recorded request facts; composition prices remain heuristic. */

import type { ConversationPromptSnapshot, RequestView } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { estimateToolsTokens } from '@deepseek-ai/dsh-token-meter/client'

/** One ordinary generation's reported prompt usage and comparable predecessor. */
export interface ContextRequestMetric {
  readonly request: Extract<RequestView, { purpose: 'assistant' }>
  readonly provider?: string
  readonly model?: string
  readonly input?: number
  readonly output?: number
  readonly cacheRatio?: number
  readonly delta?: number
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function usage(value: unknown): Pick<ContextRequestMetric, 'input' | 'output' | 'cacheRatio'> {
  if (typeof value !== 'object' || value === null) return {}
  const input = 'inputTokens' in value ? value.inputTokens : undefined
  const output = 'outputTokens' in value ? value.outputTokens : undefined
  const cacheRead = 'cacheReadTokens' in value ? value.cacheReadTokens : undefined
  const cacheWrite = 'cacheWriteTokens' in value ? value.cacheWriteTokens : undefined
  const result = count(output) ? { output } : {}
  if (!count(input) || (cacheRead !== undefined && !count(cacheRead))
    || (cacheWrite !== undefined && !count(cacheWrite))) return result
  const total = input + (cacheRead ?? 0) + (cacheWrite ?? 0)
  if (!count(total)) return result
  return {
    ...result,
    input: total,
    ...(cacheRead === undefined || total === 0 ? {} : { cacheRatio: cacheRead / total }),
  }
}

/**
 * Compare request facts relevant to diagnostics without inspecting streamed blocks.
 * @param left - previously selected requests.
 * @param right - newly published requests.
 * @returns whether diagnostic values and tool catalogs remain unchanged.
 */
export function sameContextRequests(left: readonly RequestView[], right: readonly RequestView[]): boolean {
  return left.length === right.length && left.every((request, index) => {
    const other = right[index]
    return other !== undefined && request.startSeq === other.startSeq && request.purpose === other.purpose
      && request.status === other.status && request.usage === other.usage
      && request.providerMetadata === other.providerMetadata && request.requestConfig === other.requestConfig
      && (request.purpose !== 'assistant' || other.purpose !== 'assistant' || request.prompt === other.prompt)
  })
}

/**
 * Derive reported input, cache share and input changes in loaded log order.
 * Missing usage or route identity and route switches break delta comparisons;
 * auxiliary compaction calls do not become ordinary generations.
 * @param requests - loaded trajectory requests in log order.
 * @returns ordinary request metrics; absent usage is never presented as zero.
 */
export function deriveContextRequests(requests: readonly RequestView[]): readonly ContextRequestMetric[] {
  const result: ContextRequestMetric[] = []
  for (const request of requests) {
    if (request.purpose !== 'assistant') continue
    const route = request.providerMetadata ?? request.requestConfig
    const measured = usage(request.usage)
    const previous = result.at(-1)
    const comparable = route !== undefined && previous !== undefined
      && route.provider === previous.provider && route.model === previous.model
      && previous.input !== undefined && measured.input !== undefined
    result.push({
      request,
      ...(route === undefined ? {} : { provider: route.provider, model: route.model }),
      ...measured,
      ...(comparable ? { delta: measured.input - previous.input } : {}),
    })
  }
  return result
}

/**
 * Rank each tool as a standalone catalog using the shared fixed estimator.
 * Individual prices include catalog framing and are not additive.
 * @param prompt - selected request's loaded tool catalog.
 * @returns descending standalone tool-schema prices with stable name tie-breaking.
 */
export function rankContextTools(prompt: ConversationPromptSnapshot | undefined): readonly {
  readonly tool: ConversationPromptSnapshot['tools'][number]
  readonly tokens: number
}[] {
  return prompt?.tools.map(tool => ({
    tool,
    tokens: estimateToolsTokens({
      config: { provider: prompt.config.provider, model: prompt.config.model },
      tools: [tool],
    }),
  })).sort((left, right) => right.tokens - left.tokens || left.tool.name.localeCompare(right.tool.name)) ?? []
}
