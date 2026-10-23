import type { IconProps } from './icons/props.ts'

/** Native square coordinate system of the shared Neurix N symbol. */
export const FISH_LOGO_VIEWBOX = { width: 128, height: 128 }

/** Neurix N path shared by the logo, entrance effects, and masks. */
export const FISH_LOGO_PATH = 'M12.68 111L21.2 40C23.12 24 42.84 18 51.28 31L80.64 78C82.28 81 86.4 80 86.88 76L92.04 33L115.6 20L107.44 88C105.52 104 85.8 110 77.36 97L48 50C46.36 47 42.24 48 41.76 52L36.24 98Z'

/**
 * Render the Neurix N symbol in the surrounding text color.
 * @param props.size - Square edge in px (default 24).
 * @param props.className - Extra class for layout placement.
 * @returns Decorative logo SVG; pair with the product name for accessibility.
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 128 128" fill="none" aria-hidden="true">
      <path d={FISH_LOGO_PATH} fill="currentColor" />
    </svg>
  )
}
