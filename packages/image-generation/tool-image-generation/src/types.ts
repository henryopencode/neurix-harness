/** Image-generation protocols, configuration, and resolved requests. @module */

/** Wire protocol selected independently of the configured endpoint. */
export type ImageGenerationProvider = 'openai' | 'minimax'

/** Configuration for a text-to-image endpoint; credentials never enter tool arguments or results. */
export interface ImageGenerationConfig {
  /** Image-generation wire protocol; defaults to OpenAI compatibility. */
  provider?: ImageGenerationProvider
  /** Complete HTTP(S) generation endpoint. */
  endpoint?: string
  /** Bearer API key for the configured endpoint. */
  apiKey: string
  /** Image model or deployment id accepted by the endpoint. */
  model: string
  /** Cooperative tool-call deadline, including downloads and attachment storage, in milliseconds. */
  timeoutMs?: number
  /** Maximum images requested by one invocation, also bounded by attachment admission limits. */
  maxImages?: number
  /** Failed calls allowed per agent turn; reaching this cap stops the turn and preserves pending user input. */
  maxErrorsPerTurn?: number
  /** Maximum complete JSON response bytes before parsing or base64 decoding. */
  maxResponseBytes?: number
  /** Default image size or ratio when the call omits one. */
  size?: string
  /** Provider-specific default image quality; omitted leaves quality to the provider. */
  quality?: string
  /** Optional legacy/compatible response_format; omit for GPT Image models. */
  responseFormat?: 'url' | 'b64_json'
  /** Optional output_format for endpoints that support it. */
  outputFormat?: 'png' | 'jpeg' | 'webp'
}

/** Configuration after the Loader applies schema defaults. */
export type ResolvedConfig = ImageGenerationConfig & Required<Pick<ImageGenerationConfig, 'provider' | 'endpoint' | 'timeoutMs' | 'maxImages' | 'maxErrorsPerTurn' | 'maxResponseBytes'>>

/** Model arguments resolved into the provider request before acquisition starts. */
export interface GenerationRequest {
  readonly prompt: string
  readonly count: number
  readonly size?: string
  readonly quality?: string
}
