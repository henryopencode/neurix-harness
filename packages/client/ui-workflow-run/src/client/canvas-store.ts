/** Session-scoped canvas viewing preferences survive View remounts. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

interface WorkflowCanvasState {
  graphId: string | null
  mode: 'canvas' | 'list'
  collapsed: Record<string, string[]>
}

type WorkflowCanvasActions = {
  selectGraph: (draft: WorkflowCanvasState, id: string) => void
  setMode: (draft: WorkflowCanvasState, mode: WorkflowCanvasState['mode']) => void
  togglePhase: (draft: WorkflowCanvasState, graphId: string, phase: string) => void
}

/**
 * Create a registration-owned store for graph selection and phase disclosure.
 * @returns uninstantiated store handle; the Slot runtime owns its Session instances.
 */
export function createWorkflowCanvasStore(): EngineStoreHandle<WorkflowCanvasState, WorkflowCanvasActions> {
  return defineStore({
    init: (): WorkflowCanvasState => ({ graphId: null, mode: 'canvas', collapsed: {} }),
    actions: {
      selectGraph: (draft, id: string) => { draft.graphId = id },
      setMode: (draft, mode: WorkflowCanvasState['mode']) => { draft.mode = mode },
      togglePhase: (draft, graphId: string, phase: string) => {
        const current = draft.collapsed[graphId] ?? []
        draft.collapsed[graphId] = current.includes(phase) ? current.filter(value => value !== phase) : [...current, phase]
      },
    },
  })
}
