/** Automatic dependency layout; phase collapse preserves explicit cross-phase edges. */
import { graphlib, layout } from '@dagrejs/dagre'

/** Canvas node geometry shared with React Flow's measured node box. */
export const TASK_WIDTH = 240
/** Height reserves two lines each for the task title and expected output. */
export const TASK_HEIGHT = 144

/** Structural fields alone determine positions, so status updates do not move nodes. */
export interface LayoutTask {
  readonly id: string
  readonly phase?: string
  readonly dependsOn: readonly string[]
}

/** A visible task or a collapsed stage. */
export interface LayoutNode {
  readonly id: string
  readonly taskIds: readonly string[]
  readonly phase?: string
  readonly position: { x: number; y: number }
}

/**
 * Place declared dependencies from left to right without imposing phase order.
 * @param tasks - stable task ids, phases, and explicit prerequisites.
 * @param collapsed - phase names currently represented by one node.
 * @returns visible nodes and deduplicated prerequisite edges.
 */
export function layoutWorkflow(tasks: readonly LayoutTask[], collapsed: readonly string[]): {
  nodes: LayoutNode[]
  edges: { id: string; source: string; target: string }[]
} {
  const folded = new Set(collapsed)
  const original = new graphlib.Graph<Record<string, never>, Record<string, never>, Record<string, never>>()
  for (const task of tasks) original.setNode(task.id)
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (original.hasNode(dependency)) original.setEdge(dependency, task.id)
    }
  }
  const layers = new Map<string, number>()
  if (graphlib.alg.isAcyclic(original)) {
    for (const id of graphlib.alg.topsort(original)) {
      // Every registered node has a predecessor list, and topsort visits its parents first.
      const parents = original.predecessors(id) as string[]
      layers.set(id, Math.max(0, ...parents.map(parent => (layers.get(parent) as number) + 1)))
    }
  }
  const projected = project(tasks, folded)
  // A phase may occur on both sides of another phase. Combining it would invent a cycle.
  const visible = !graphlib.alg.isAcyclic(projected.graph) && layers.size > 0
    ? project(tasks, folded, layers) : projected
  layout(visible.graph)
  const nodes: LayoutNode[] = [...visible.nodes].map(([id, data]) => {
    const point = visible.graph.node(id) as { x: number; y: number }
    return { id, ...data, position: { x: point.x - TASK_WIDTH / 2, y: point.y - TASK_HEIGHT / 2 } }
  })
  return { nodes, edges: [...visible.edges.values()] }
}

function project(tasks: readonly LayoutTask[], folded: ReadonlySet<string>, layers?: ReadonlyMap<string, number>) {
  const visible = new Map<string, { taskIds: string[]; phase?: string }>()
  const taskNodes = new Map<string, string>()
  for (const task of tasks) {
    const phase = task.phase
    const isFolded = phase !== undefined && folded.has(phase)
    const id = isFolded
      ? `phase:${layers === undefined ? phase : JSON.stringify([phase, layers.get(task.id)])}` : `task:${task.id}`
    taskNodes.set(task.id, id)
    const node = visible.get(id)
    if (node === undefined) visible.set(id, { taskIds: [task.id], ...isFolded ? { phase } : {} })
    else node.taskIds.push(task.id)
  }
  const edges = new Map<string, { id: string; source: string; target: string }>()
  for (const task of tasks) {
    const target = taskNodes.get(task.id)
    for (const dependency of task.dependsOn) {
      const source = taskNodes.get(dependency)
      if (source === undefined || target === undefined || source === target) continue
      const id = JSON.stringify([source, target])
      edges.set(id, { id, source, target })
    }
  }
  const graph = new graphlib.Graph<Record<string, string | number>, Record<string, number>, Record<string, never>>()
    .setGraph({ rankdir: 'LR', ranksep: 64, nodesep: 32 })
    .setDefaultEdgeLabel(() => ({}))
  for (const id of visible.keys()) graph.setNode(id, { width: TASK_WIDTH, height: TASK_HEIGHT })
  for (const edge of edges.values()) graph.setEdge(edge.source, edge.target)
  return { graph, nodes: visible, edges }
}
