/** Animated Neurix N mask and static SVG fallback for the running Chat status. */
import { FISH_LOGO_PATH, FISH_LOGO_VIEWBOX } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ChatView.module.css'

/**
 * Render the decorative running icon; the APNG asset owns its animation timing.
 * @returns mask and static SVG selected by browser capabilities and accessibility preferences.
 */
export function RunningWhaleTail() {
  return (
    <span className={css.runningIcon} aria-hidden="true">
      <span className={css.runningWhaleAnimated} />
      <svg className={css.runningWhaleStill} width="100%" height="100%" viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`} fill="none">
        <path d={FISH_LOGO_PATH} fill="currentColor" />
      </svg>
    </span>
  )
}
