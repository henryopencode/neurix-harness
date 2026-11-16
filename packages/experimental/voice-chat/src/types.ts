/** JSON values shared by local speech preparation and its browser controls. */
import type {} from '@deepseek-ai/dsh-typert-protocol'

/** Locally executable Breeze weight variants. */
export type VoiceModel = 'mlx-4bit' | 'mlx-8bit'

/** Hardware facts used before downloading weights. */
export interface VoiceHardware {
  readonly platform: string
  readonly architecture: string
  readonly memoryBytes: number
}

/** One complete preparation observation; downloads never start from observation. */
export interface VoiceStatus {
  readonly phase: 'unprepared' | 'preparing' | 'ready' | 'unsupported' | 'failed'
  readonly model: VoiceModel | null
  readonly hardware: VoiceHardware
  readonly downloadBytes: number
  readonly completedBytes: number
  readonly operation: 'runtime' | 'model' | 'loading' | null
  readonly error?: 'download' | 'runtime' | undefined
}

/** Detection and playback limits selected by the Host composition. */
export interface VoiceOptions {
  readonly speechThreshold: number
  readonly silenceMs: number
  readonly minimumSpeechMs: number
  readonly preRollMs: number
  readonly maxUtteranceSeconds: number
  readonly maxSentenceCharacters: number
  readonly maxPendingSentences: number
  readonly warmupText: string
}

/** One mono signed PCM16 little-endian playback fragment. */
export interface VoiceAudio {
  readonly pcmBase64: string
  readonly sampleRate: number
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Local synthesis failed; callers stop playback and offer a fresh attempt. */
    'voice-chat/failed': { readonly reason: 'not-ready' | 'busy' | 'inference' | 'invalid-text' }
  }
}
