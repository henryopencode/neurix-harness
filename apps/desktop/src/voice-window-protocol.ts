/** Validated messages for the shell-owned compact voice window. */
import type { DesktopVoiceCommand, DesktopVoiceState } from '@deepseek-ai/dsh-voice-chat/types'

/** Private channels never exposed as arbitrary renderer IPC. */
export const VOICE_WINDOW_IPC = {
  publish: 'dsh-desktop:voice-publish', minimize: 'dsh-desktop:voice-minimize',
  state: 'dsh-desktop:voice-state', changed: 'dsh-desktop:voice-changed', command: 'dsh-desktop:voice-command',
  action: 'dsh-desktop:voice-action',
} as const

/** Revisioned initial reads and pushes cannot overwrite a newer control state. */
export interface VoiceWindowSnapshot { readonly revision: number; readonly state: DesktopVoiceState | null }

/** API supplied only to the compact window's owned top frame. */
export interface VoiceWindowApi {
  /** @returns the latest shell-owned audio state. */
  state(): Promise<VoiceWindowSnapshot>
  /** @param command - one audio or restore action. @returns after the shell routes the action. */
  command(command: DesktopVoiceCommand): Promise<void>
  /** @param listener - receives subsequent revisions. @returns the listener disposer. */
  subscribe(listener: (snapshot: VoiceWindowSnapshot) => void): () => void
}

/**
 * Validate the product renderer's compact audio state and discard unrelated fields.
 * @param input - process message from the owning application frame.
 * @returns a complete audio-only state, or null after audio has ended.
 */
export function parseDesktopVoiceState(input: unknown): DesktopVoiceState | null {
  if (input === null) return null
  if (!input || typeof input !== 'object') throw new Error('Invalid desktop voice state')
  const state = input as Record<string, unknown>
  const phases = new Set(['requesting', 'warming', 'listening', 'recording', 'transcribing', 'thinking', 'speaking', 'stopping'])
  if (typeof state.phase !== 'string' || !phases.has(state.phase)
    || typeof state.microphoneMuted !== 'boolean' || typeof state.speakerMuted !== 'boolean'
    || !state.labels || typeof state.labels !== 'object') throw new Error('Invalid desktop voice state')
  const { inputLevel, sentCount } = state
  if (inputLevel !== undefined && (typeof inputLevel !== 'number' || !Number.isFinite(inputLevel) || inputLevel < 0 || inputLevel > 1)
    || sentCount !== undefined && (typeof sentCount !== 'number' || !Number.isSafeInteger(sentCount) || sentCount < 0)) {
    throw new Error('Invalid desktop voice feedback')
  }
  const labels = state.labels as Record<string, unknown>
  const text = (key: keyof DesktopVoiceState['labels']): string => {
    const value = labels[key]
    if (typeof value !== 'string' || value.length === 0 || value.length > 512) throw new Error(`Invalid desktop voice label: ${key}`)
    return value
  }
  return { phase: state.phase as DesktopVoiceState['phase'], microphoneMuted: state.microphoneMuted, speakerMuted: state.speakerMuted,
    ...(inputLevel === undefined ? {} : { inputLevel }), ...(sentCount === undefined ? {} : { sentCount }),
    labels: { status: text('status'), muteMicrophone: text('muteMicrophone'), unmuteMicrophone: text('unmuteMicrophone'),
      muteSpeaker: text('muteSpeaker'), unmuteSpeaker: text('unmuteSpeaker'), end: text('end'), restore: text('restore') } }
}

/**
 * Reject arbitrary compact-window actions.
 * @param input - requested action at the process boundary.
 * @returns one supported audio or window action.
 */
export function parseDesktopVoiceCommand(input: unknown): DesktopVoiceCommand {
  if (input === 'microphone' || input === 'speaker' || input === 'end' || input === 'restore') return input
  throw new Error('Invalid desktop voice command')
}

/**
 * Validate revisioned shell responses before rendering them.
 * @param input - initial state or pushed snapshot.
 * @returns the checked revision and audio state.
 */
export function parseVoiceWindowSnapshot(input: unknown): VoiceWindowSnapshot {
  if (!input || typeof input !== 'object' || !('revision' in input) || !('state' in input)
    || typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || input.revision < 0) {
    throw new Error('Invalid desktop voice revision')
  }
  return { revision: input.revision, state: parseDesktopVoiceState(input.state) }
}
