/** Decorative artwork for voice activity. */
import css from './VoiceOrb.module.css'

/**
 * Display preparation, recording, or playback without owning audio state.
 * @param props.phase - caller's phase. Other phases use the resting artwork.
 * @returns Decorative artwork; pair with the caller's accessible status.
 */
export function VoiceOrb({ phase }: { readonly phase: string }) {
  return <div className={css.orb} data-voice-orb={phase} aria-hidden="true" />
}
