/** Interactive source graph: local pan and zoom, keyboard-selectable nodes, and no remote state inside rendering. */

import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Button, IconBookmarkOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
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

/**
 * Render real document/keyword associations with fixed-size accessible node controls.
 * @param props - Immutable source graph and a single selection callback.
 * @returns A pannable graph whose controls remain reachable at narrow widths.
 */
export function KnowledgeGraph({ nodes, edges, selected, select, t }: KnowledgeGraphProps): ReactNode {
  const positions = useMemo(() => layoutGraph(nodes, edges), [nodes, edges])
  const byId = useMemo(() => new Map(positions.map(point => [point.node.id, point])), [positions])
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  return <div className={css.graphViewport} role="region" aria-label={t('graph')}
    onPointerDown={(event) => {
      if (event.target instanceof Element && event.target.closest('button')) return
      drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={(event) => {
      const start = drag.current
      if (start !== null) setPan({ x: start.panX + event.clientX - start.x, y: start.panY + event.clientY - start.y })
    }}
    onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}
    onLostPointerCapture={() => { drag.current = null }}>
    <div className={css.graphLegend}>
      <span><i className={css.documentDot} />{t('documents')}</span>
      <span><i className={css.keywordDot} />{t('keywords')}</span>
    </div>
    <div className={css.graphScene} style={{
      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, '--knowledge-zoom': zoom,
    } as CSSProperties}>
      <svg className={css.edges} viewBox="0 0 1000 720" preserveAspectRatio="none" aria-hidden="true">
        {edges.map((edge) => {
          const source = byId.get(edge.source)
          const target = byId.get(edge.target)
          if (source === undefined || target === undefined) return null
          return <line key={`${edge.source}:${edge.target}`}
            x1={source.x * 1000} y1={source.y * 720} x2={target.x * 1000} y2={target.y * 720}
            style={{ strokeWidth: selected === edge.source || selected === edge.target
              ? 2.5 : Math.min(2.2, 1 + Math.log2(1 + edge.occurrences) * 0.2) }}
            data-active={selected === edge.source || selected === edge.target} />
        })}
      </svg>
      {positions.map(({ node, x, y }) => <button key={node.id} type="button"
        className={node.kind === 'document' ? css.documentNode : css.keywordNode}
        style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
        aria-label={`${t(node.kind === 'document' ? 'document' : 'keyword')}: ${node.label}`}
        aria-pressed={selected === node.id} onClick={() => { select(node) }}>
        {node.kind === 'document' && <IconBookmarkOutlineRegular size={19} />}
        <span className={node.kind === 'document' ? css.documentLabel : css.keywordLabel}>{node.label}</span>
      </button>)}
    </div>
    <div className={css.graphControls}>
      <Tooltip label={t('zoomOut')} portal><Button aria-label={t('zoomOut')}
        onClick={() => { setZoom(value => Math.max(0.6, value - 0.25)) }}><span aria-hidden="true">−</span></Button></Tooltip>
      <Tooltip label={t('zoomIn')} portal><Button aria-label={t('zoomIn')}
        onClick={() => { setZoom(value => Math.min(3, value + 0.25)) }}><IconPlusOutlineRegular size={15} /></Button></Tooltip>
      <Tooltip label={t('resetView')} portal><Button aria-label={t('resetView')}
        onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}><IconRefreshOutlineRegular size={15} /></Button></Tooltip>
    </div>
  </div>
}
