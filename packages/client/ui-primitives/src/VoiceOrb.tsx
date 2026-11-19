/** Decorative artwork for voice activity. */
import { useEffect, useRef, type CSSProperties } from 'react'
import css from './VoiceOrb.module.css'

/**
 * Display voice activity without owning capture, playback, or layout.
 * @param props.phase - the caller's phase; unrecognized phases use the resting artwork.
 * @param props.visible - whether to show the orb; retain the element for exit motion.
 * @param props.inputLevel - normalized microphone amplitude from zero to one.
 * @param props.sentCount - increasing receipt count for the current activation.
 * @returns Decorative artwork; pair with the caller's accessible status.
 */
export function VoiceOrb({ phase, visible = true, inputLevel = 0, sentCount = 0 }: {
  readonly phase: string
  readonly visible?: boolean
  readonly inputLevel?: number
  readonly sentCount?: number
}) {
  const flash = useRef<HTMLSpanElement>(null), previous = useRef(sentCount)
  useEffect(() => {
    const accepted = sentCount > previous.current
    previous.current = sentCount
    if (!accepted || !visible || !flash.current) return
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    const animation = flash.current.animate([
      { opacity: 0.9, scale: reducedMotion ? 1 : 0.88 },
      { opacity: 0, scale: reducedMotion ? 1 : 1.22 },
    ], { duration: 340, easing: 'ease-out' })
    return () => { animation.cancel() }
  }, [sentCount, visible])

  return <div className={css.orb} data-voice-orb={phase} data-voice-orb-hidden={visible ? undefined : ''} aria-hidden="true"
    style={{ '--voice-orb-input': inputLevel } as CSSProperties}>
    <span className={css.core} />
    <span ref={flash} className={css.flash} />
  </div>
}
