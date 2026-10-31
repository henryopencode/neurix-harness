/** Operating surface selection and shared display-only preview records. @module */

export type { ComputerPreviewCursor, ComputerPreviewFrame, ComputerPreviewCapture, RegisterComputerPreview }
  from '@deepseek-ai/dsh-client-ui-computer-preview/types'

/** Operations admitted by one independently enabled control provider. */
export type ComputerSurface = 'all' | 'browser' | 'applications'
