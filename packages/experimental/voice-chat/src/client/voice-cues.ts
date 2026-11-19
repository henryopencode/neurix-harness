/** Short interface sounds mixed through the conversation's speaker gain. */

const notes = {
  open: [[440, 0, 0.12], [660, 0.05, 0.14]],
  sent: [[740, 0, 0.09], [990, 0.035, 0.11]],
  close: [[590, 0, 0.11], [390, 0.045, 0.13]],
} as const

/** Let the close sound and the compact window's exit finish after capture stops. */
export const CLOSE_FEEDBACK_MS = 220

/**
 * Schedule a quiet cue on the already unlocked output.
 * @param context - Conversation audio clock.
 * @param destination - The speaker mute gain.
 * @param cue - The interaction being acknowledged.
 */
export function playVoiceCue(context: AudioContext, destination: GainNode, cue: keyof typeof notes): void {
  const now = context.currentTime
  for (const [pitch, offset, duration] of notes[cue]) {
    const tone = context.createOscillator(), envelope = new GainNode(context)
    const start = now + offset, end = start + duration
    tone.frequency.value = pitch
    envelope.gain.setValueAtTime(0, start)
    envelope.gain.linearRampToValueAtTime(0.055, start + 0.012)
    envelope.gain.exponentialRampToValueAtTime(0.001, end)
    tone.connect(envelope).connect(destination)
    tone.onended = () => { tone.disconnect(); envelope.disconnect() }
    tone.start(start)
    tone.stop(end)
  }
}
