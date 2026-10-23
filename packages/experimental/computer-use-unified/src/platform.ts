/** Native desktop input availability for this Host process. @module */

import { platform } from 'node:os'

/** The unified provider's native launch, observation, and input implementation requires macOS. */
export const nativeDesktopSupported = platform() === 'darwin'
