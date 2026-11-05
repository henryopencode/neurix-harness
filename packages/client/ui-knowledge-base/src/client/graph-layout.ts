/** Deterministic D3 layout with its simulation stopped before synchronous calculation. */

import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force'
import type { GraphEdge, GraphNode } from './types.ts'

/** One normalized graph position, projected onto the current canvas by CSS. */
export interface GraphPosition {
  readonly node: GraphNode
  readonly x: number
  readonly y: number
}

/**
 * Position graph nodes without mutating Remote snapshots or retaining a simulation.
 * @param nodes - Source-derived document and keyword nodes.
 * @param edges - Observed document-to-keyword associations.
 * @returns Stable normalized positions with room for labels around the graph edges.
 */
export function layoutGraph(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): GraphPosition[] {
  if (nodes.length === 0) return []
  if (nodes.length === 1) return nodes.map(node => ({ node, x: 0.5, y: 0.5 }))
  const points = nodes.map((node, i) => ({
    id: node.id, node, x: 500 + Math.cos(i * 2.4) * 200, y: 360 + Math.sin(i * 2.4) * 180,
  }))
  const links = edges.map(edge => ({ source: edge.source, target: edge.target }))
  forceSimulation(points).stop()
    .force('link', forceLink<typeof points[number], typeof links[number]>(links).id(node => node.id).distance(110))
    .force('charge', forceManyBody().strength(-260))
    .force('center', forceCenter(500, 360))
    .force('collision', forceCollide(52))
    .tick(140)
  const minX = Math.min(...points.map(point => point.x))
  const maxX = Math.max(...points.map(point => point.x))
  const minY = Math.min(...points.map(point => point.y))
  const maxY = Math.max(...points.map(point => point.y))
  return points.map(point => ({
    node: point.node,
    x: maxX === minX ? 0.5 : 0.16 + (point.x - minX) / (maxX - minX) * 0.68,
    y: maxY === minY ? 0.5 : 0.14 + (point.y - minY) / (maxY - minY) * 0.72,
  }))
}
