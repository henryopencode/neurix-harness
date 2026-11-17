/** JSON values shared by local speech preparation and its browser controls. */
import type {} from '@deepseek-ai/dsh-typert-protocol'

/** Locally executable Breeze weight variants. */
export type VoiceModel = 'mlx-4bit' | 'mlx-8bit'

/** Built-in voice designs; each uses one reusable local reference recording. */
export type VoicePreset = 'natural' | 'warm' | 'calm'

/** An explicit voice selection; string-only synthesis retains the deployment's default. */
export interface VoiceSynthesisRequest { readonly text: string; readonly voice: VoicePreset }

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
  readonly operation: 'runtime' | 'python' | 'dependencies' | 'model' | 'loading' | null
  readonly error?: 'download' | 'runtime' | undefined
  readonly failedStep?: 'assets' | 'python' | 'dependencies' | 'model' | 'loading' | undefined
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
  readonly voice: VoicePreset
  readonly playbackBufferMs: number
}

/** One mono signed PCM16 little-endian playback fragment. */
export interface VoiceAudio {
  readonly pcmBase64: string
  readonly sampleRate: number
}

/** Browser conversation state displayed by both the main window and desktop controls. */
export type VoiceConversationPhase = 'idle' | 'requesting' | 'warming' | 'listening' | 'recording' | 'transcribing' | 'thinking' | 'speaking' | 'stopping'

/** Commands accepted from the owned desktop voice window. */
export type DesktopVoiceCommand = 'microphone' | 'speaker' | 'end' | 'restore'

/** Shell control actions and a failure that requires ending hidden audio. */
export type DesktopVoiceEvent = DesktopVoiceCommand | 'unavailable'

/** Localized desktop control labels, supplied by the voice plugin's active locale. */
export interface DesktopVoiceLabels {
  readonly status: string
  readonly muteMicrophone: string
  readonly unmuteMicrophone: string
  readonly muteSpeaker: string
  readonly unmuteSpeaker: string
  readonly end: string
  readonly restore: string
}

/** Compact audio state; it contains no conversation titles, transcripts, or task inventory. */
export interface DesktopVoiceState {
  readonly phase: Exclude<VoiceConversationPhase, 'idle'>
  readonly microphoneMuted: boolean
  readonly speakerMuted: boolean
  readonly labels: DesktopVoiceLabels
}

/** Optional desktop-owned controls; browser-only clients retain their foreground audio lifetime. */
export interface DesktopVoiceBridge {
  /** @param state - current audio state; null withdraws the controls after audio release. @returns after the shell accepts the state. */
  publish(state: DesktopVoiceState | null): Promise<void>
  /** @returns after the main window is minimized and the compact controls are requested. */
  minimize(): Promise<void>
  /** @param listener - receiver for owned audio-control actions. @returns the listener disposer. */
  subscribe(listener: (command: DesktopVoiceEvent) => void): () => void
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Local synthesis failed; callers stop playback and offer a fresh attempt. */
    'voice-chat/failed': { readonly reason: 'not-ready' | 'busy' | 'inference' | 'invalid-text' }
  }
}
