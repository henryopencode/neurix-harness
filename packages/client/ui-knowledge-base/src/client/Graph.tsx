/** Interactive source graph with pointer-centered zoom and independently draggable nodes. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Button, IconRefreshOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { layoutGraph } from './graph-layout.ts'
import type { GraphEdge, GraphNode, Translate } from './types.ts'
import css from './Knowledge.module.css'

/** Data and selection commands for one graph viewport. */
export interface KnowledgeGraphProps {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  readonly selected: GraphNode['id'] | null
  readonly select: (node: GraphNode) => void
  readonly t: Translate
}

interface Point { readonly x: number; readonly y: number }
interface Camera extends Point { readonly zoom: number }
interface Drag {
  readonly start: Point
  readonly origin: Point
  readonly node: GraphNode['id'] | null
  readonly width: number
  readonly height: number
  readonly zoom: number
}

function zoomAt(camera: Camera, factor: number, point: Point): Camera {
  const zoom = Math.max(0.35, Math.min(3.5, camera.zoom * factor))
  const ratio = zoom / camera.zoom
  return { zoom, x: point.x - (point.x - camera.x) * ratio, y: point.y - (point.y - camera.y) * ratio }
}

/**
 * Render observed associations as a graph whose node size reflects its connection count.
 * @param props - Immutable graph, selection callback, and localized labels.
 * @returns A keyboard-accessible graph with wheel zoom, node dragging, and pan gestures.
 */
export function KnowledgeGraph({ nodes, edges, selected, select, t }: KnowledgeGraphProps): ReactNode {
  const layout = useMemo(() => layoutGraph(nodes, edges), [nodes, edges])
  const [overrides, setOverrides] = useState<ReadonlyMap<GraphNode['id'], Point>>(new Map())
  const positions = layout.map(point => ({ ...point, ...overrides.get(point.node.id) }))
  const byId = new Map(positions.map(point => [point.node.id, point]))
  const degree = new Map<GraphNode['id'], number>()
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }
  const [camera, setCamera] = useState<Camera>({ zoom: 1, x: 0, y: 0 })
  const [hovered, setHovered] = useState<GraphNode['id'] | null>(null)
  const active = hovered ?? selected
  const connected = new Set([active])
  for (const edge of edges) {
    if (edge.source === active) connected.add(edge.target)
    if (edge.target === active) connected.add(edge.source)
  }
  const viewport = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const moved = useRef(false)
  useEffect(() => {
    const element = viewport.current
    if (element === null) return
    const wheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1)
      setCamera(value => zoomAt(value, Math.exp(-delta * 0.0015), { x: event.clientX - rect.left, y: event.clientY - rect.top }))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => { element.removeEventListener('wheel', wheel) }
  }, [])
  function reset(): void { setCamera({ zoom: 1, x: 0, y: 0 }); setOverrides(new Map()) }
  return <div ref={viewport} className={css.graphViewport} role="region" tabIndex={0} aria-label={t('graph')}
    onKeyDown={(event) => {
      if (event.key === '0' || event.key === 'Home') { event.preventDefault(); reset() }
      if (event.key === '+' || event.key === '-' || event.key === '=') {
        event.preventDefault()
        const rect = event.currentTarget.getBoundingClientRect()
        setCamera(value => zoomAt(value, event.key === '-' ? 0.8 : 1.25, { x: rect.width / 2, y: rect.height / 2 }))
      }
    }}
    onPointerDown={(event) => {
      if (event.button !== 0) return
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null
      if (button !== null && button.dataset['nodeId'] === undefined) return
      const node = positions.find(point => point.node.id === button?.dataset['nodeId'])
      const rect = event.currentTarget.getBoundingClientRect()
      moved.current = false
      drag.current = { start: { x: event.clientX, y: event.clientY }, origin: node ?? camera,
        node: node?.node.id ?? null, width: rect.width, height: rect.height, zoom: camera.zoom }
      ;(button ?? event.currentTarget).setPointerCapture(event.pointerId)
    }}
    onPointerMove={(event) => {
      const start = drag.current
      if (start === null) return
      const dx = event.clientX - start.start.x
      const dy = event.clientY - start.start.y
      if (Math.hypot(dx, dy) > 4) moved.current = true
      if (!moved.current) return
      const nodeId = start.node
      if (nodeId === null) setCamera(value => ({ ...value, x: start.origin.x + dx, y: start.origin.y + dy }))
      else if (start.width > 0 && start.height > 0) setOverrides(value => new Map(value).set(nodeId, {
        x: Math.max(0.03, Math.min(0.97, start.origin.x + dx / start.width / start.zoom)),
        y: Math.max(0.06, Math.min(0.94, start.origin.y + dy / start.height / start.zoom)),
      }))
    }}
    onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}
    onLostPointerCapture={() => { drag.current = null }}>
    <div className={css.graphLegend}>
      <span><i className={css.documentDot} />{t('documents')}</span>
      <span><i className={css.keywordDot} />{t('keywords')}</span>
    </div>
    <div className={css.graphScene} style={{
      transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`, '--knowledge-zoom': camera.zoom,
    } as CSSProperties}>
      <svg className={css.edges} viewBox="0 0 1000 720" preserveAspectRatio="none" aria-hidden="true">
        {edges.map((edge) => {
          const source = byId.get(edge.source)
          const target = byId.get(edge.target)
          if (source === undefined || target === undefined) return null
          const related = active === edge.source || active === edge.target
          return <line key={`${edge.source}:${edge.target}`}
            x1={source.x * 1000} y1={source.y * 720} x2={target.x * 1000} y2={target.y * 720}
            data-active={related} data-dim={active !== null && !related} />
        })}
      </svg>
      {positions.map(({ node, x, y }) => <button key={node.id} type="button" data-node-id={node.id}
        className={node.kind === 'document' ? css.documentNode : css.keywordNode}
        style={{ left: `${x * 100}%`, top: `${y * 100}%`, '--node-size': `${Math.min(24, (node.kind === 'document' ? 9 : 5) + Math.sqrt(degree.get(node.id) ?? 0) * 3)}px` } as CSSProperties}
        data-dim={active !== null && !connected.has(node.id)} data-active={active === node.id}
        aria-label={`${t(node.kind === 'document' ? 'document' : 'keyword')}: ${node.label}`}
        aria-pressed={selected === node.id}
        onPointerEnter={(event) => { if (event.pointerType !== 'touch') setHovered(node.id) }}
        onPointerLeave={() => { setHovered(null) }} onFocus={() => { setHovered(node.id) }} onBlur={() => { setHovered(null) }}
        onClick={(event) => { if (event.detail === 0 || !moved.current) select(node) }}>
        <span className={css.nodeMark} aria-hidden="true" />
        <span className={node.kind === 'document' ? css.documentLabel : css.keywordLabel}>{node.label}</span>
      </button>)}
    </div>
    <div className={css.graphControls}>
      <Tooltip label={t('resetView')} portal><Button aria-label={t('resetView')} onClick={reset}>
        <IconRefreshOutlineRegular size={16} /></Button></Tooltip>
    </div>
  </div>
}
