/** Decorative voice companion; expression follows real readiness and conversation phases. */
import type { PointerEvent } from 'react'
import type { VoiceConversationPhase } from '../types.ts'
import css from './VoiceOrb.module.css'

/** Visual state contains no microphone samples or conversation text. */
export interface VoiceOrbProps {
  readonly phase: VoiceConversationPhase | 'error'
  readonly muted: boolean
}

/**
 * Render a motion-aware face with a small, pointer-local gaze interaction.
 * @param props - actual conversation phase and input mute state.
 * @returns decorative artwork; its owner supplies accessible status and controls.
 */
export function VoiceOrb({ phase, muted }: VoiceOrbProps) {
  const gaze = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'touch' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const orb = event.currentTarget, bounds = orb.getBoundingClientRect()
    orb.style.setProperty('--voice-gaze-x', `${Math.max(-7, Math.min(7, (event.clientX - bounds.x - bounds.width / 2) / 8))}px`)
    orb.style.setProperty('--voice-gaze-y', `${Math.max(-5, Math.min(5, (event.clientY - bounds.y - bounds.height / 2) / 10))}px`)
  }
  return <div className={css.companion} data-voice-orb={phase} data-muted={muted} aria-hidden="true"
    onPointerMove={gaze} onPointerLeave={(event) => {
      event.currentTarget.style.setProperty('--voice-gaze-x', '0px')
      event.currentTarget.style.setProperty('--voice-gaze-y', '0px')
    }}>
    <div className={css.halo} />
    <div className={css.body}>
      <div className={css.face}>
        <div className={css.gaze}><div className={css.eyes}><span className={css.eye} /><span className={css.eye} /></div>
          <span className={css.mouth} />
        </div>
      </div>
      <span className={css.shine} />
    </div>
    <div className={css.thoughts}><span /><span /><span /></div>
  </div>
}
