/** Shared configured model catalog supplied to group settings. @module */
import type { ModelDirectoryResolver } from '@deepseek-ai/dsh-client-ui-model-selection/client'

/** Browser discovery state and explicit retry action. */
export interface TeamCatalogFace {
  readonly hooks: { readonly teamCatalog: ReturnType<ModelDirectoryResolver['catalogSource']> }
  /** Request a fresh catalog after an error or provider update. */
  readonly refreshCatalog: () => void
}
