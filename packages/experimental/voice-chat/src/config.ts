/** Deployment-owned preparation, voice, and turn-detection settings. */
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Local speech configuration; activation does not install or load a model. */
export const Config = z.object({
  dataRoot: z.string().min(1).required(),
  model: z.union(['auto', 'mlx-4bit', 'mlx-8bit']).default('auto'),
  modelOrigin: z.string().pattern(/^https?:\/\/[^/\s?#@]+\/?$/).default('https://huggingface.co'),
  downloadConnections: z.natural().min(1).max(16).default(8),
  downloadChunkBytes: z.natural().min(1024 * 1024).max(32 * 1024 * 1024).default(4 * 1024 * 1024),
  instruction: z.string().default('清晰自然、语气亲切的声音。'),
  voice: z.union(['natural', 'warm', 'calm']).default('natural'),
  voiceInstructions: z.object({
    warm: z.string().min(1).default('一位温柔亲切的年轻女性，声音柔和清晰，语速自然。'),
    calm: z.string().min(1).default('一位沉稳温和的成年男性，声音低沉清晰，语速自然。'),
  }).default({}),
  referenceText: z.string().min(1).max(100).default('你好，很高兴和你聊天。我们可以慢慢讨论，一起找到合适的答案。'),
  voiceDesignCfgScale: z.number().min(1).max(4).default(3),
  referenceMaxSeconds: z.number().min(1).max(30).default(15),
  cfgScale: z.number().min(1).max(4).default(1),
  seed: z.natural().max(4294967295).default(42),
  warmupText: z.string().max(16).default('你好。'),
  prepareTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(3_600_000),
  inferenceTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(120_000),
  idleTimeoutMs: z.natural().max(MAX_TIMER_DELAY_MS).default(300_000),
  graceMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(1000),
  maxLogBytes: z.natural().min(1024).default(64 * 1024),
  maxAudioBytes: z.natural().min(48000).default(4 * 1024 * 1024),
  maxTokens: z.natural().min(1).max(1500).default(750),
  streamingIntervalSeconds: z.number().min(0.08).max(2).default(0.48),
  playbackBufferMs: z.natural().min(0).max(2000).default(1200),
  playbackResumeTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(5000),
  speechThreshold: z.number().min(0.001).max(1).default(0.025),
  silenceMs: z.natural().min(100).max(5000).default(650),
  minimumSpeechMs: z.natural().min(50).max(2000).default(180),
  preRollMs: z.natural().min(0).max(1000).default(300),
  maxUtteranceSeconds: z.number().min(1).max(120).default(30),
  maxPendingUtterances: z.natural().min(2).max(16).default(4),
  maxSentenceCharacters: z.natural().min(20).max(1000).default(100),
  maxPendingSentences: z.natural().min(1).max(128).default(32),
  maxPendingSyntheses: z.natural().min(1).max(16).default(4),
})

/** Validated local speech configuration. */
export type Config = ReturnType<typeof Config>
