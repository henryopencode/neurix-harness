/** Shared settings viewing state for its mouse and command entry points. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

type State = {
  open: boolean
  activeId: string | undefined
  requestedOnboarding: { id: string; chooseMethod: boolean } | undefined
}
type Actions = {
  open(draft: State): void
  close(draft: State): void
  select(draft: State, id: string): void
  openSection(draft: State, id: string): void
  openOnboarding(draft: State, id: string, chooseMethod?: boolean): void
  completeOnboarding(draft: State, id: string): void
}

/**
 * Declare the settings dialog state and its complete mutation API.
 * @returns one root-scoped store handle for the settings shell.
 */
export function createSettingsShellStore(): EngineStoreHandle<State, Actions> {
  return defineStore({
    init: (): State => ({ open: false, activeId: undefined, requestedOnboarding: undefined }),
    actions: {
      open: (d) => { d.open = true },
      close: (d) => { d.open = false; d.activeId = undefined },
      select: (d, id: string) => { d.activeId = id },
      openSection: (d, id: string) => { d.activeId = id; d.open = true },
      openOnboarding: (d, id: string, chooseMethod = false) => {
        d.open = false
        d.activeId = undefined
        d.requestedOnboarding = { id, chooseMethod }
      },
      completeOnboarding: (d, id: string) => {
        if (d.requestedOnboarding?.id === id) d.requestedOnboarding = undefined
      },
    },
  })
}
