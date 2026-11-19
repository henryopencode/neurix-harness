/** Decorative artwork shared by the composer and compact desktop controls. */
import type { VoiceConversationPhase } from '../types.ts'
import css from './VoiceOrb.module.css'

/**
 * Render a voice orb that reflects the current audio phase.
 * @param props - the audio owner's phase; the orb has no controls or accessible text.
 * @returns decorative artwork inside the caller's layout.
 */
export function VoiceOrb({ phase }: { readonly phase: VoiceConversationPhase }) {
  return <div className={css.orb} data-voice-orb={phase} aria-hidden="true" />
}
