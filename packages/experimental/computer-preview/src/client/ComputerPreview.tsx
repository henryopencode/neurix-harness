/** Session-scoped, focus-preserving picture-in-picture for the current computer target. @module */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Button, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconCopyOutlineRegular,
  IconFullscreenOutlineRegular, IconPanelLeftOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComputerPreviewSnapshot } from '../types.ts'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { fitPreviewLayout, resizePreviewLayout, type PreviewLayout } from './preview-layout.ts'
import css from './ComputerPreview.module.css'

/** Cancellable display-only reader injected by the optional Remote contribution. */
export interface ComputerPreviewInjected {
  /** Independent source identity for labels and initial panel position. */
  surface: 'applications' | 'browser'
  /**
   * @param sessionId - Session displayed by the header.
   * @param signal - this preview's viewing lifetime.
   * @returns the target image and Host-selected refresh interval.
   */
  loadPreview: (sessionId: SessionId, signal: AbortSignal) => Promise<ComputerPreviewSnapshot>
}

/** Header utilities supply the selected Session while the panel renders through a portal. */
export type ComputerPreviewProps = PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<'computerPreview'> & InjectFace<ComputerPreviewInjected>

/**
 * Display the actual target without activating it; collapsing stops capture.
 * @param props - exact Session, read-only capture, and localized controls.
 * @returns the floating panel when a target or capture failure is available.
 */
export function ComputerPreview({ sessionId, loadPreview, t, surface }: ComputerPreviewProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [retry, setRetry] = useState(0)
  const [view, setView] = useState<{
    sessionId: SessionId
    snapshot?: ComputerPreviewSnapshot
    failed: boolean
    failure?: Extract<ComputerPreviewSnapshot['frame'], { kind: 'unavailable' }>['code']
    aspect: number
  }>({
    sessionId, failed: false, aspect: 1.6,
  })
  const [layout, setLayout] = useState<PreviewLayout>()
  const panel = useRef<HTMLElement>(null)
  const dragging = useRef<{ pointerId: number; element: HTMLElement; x: number; y: number; start: PreviewLayout; edge?: 'left' | 'right' }>()
  useEffect(() => {
    if (collapsed) return
    const lifetime = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setView(current => current.sessionId === sessionId ? current : { sessionId, failed: false, aspect: 1.6 })
    const read = async () => {
      let refreshMs: number | undefined
      try {
        const snapshot = await loadPreview(sessionId, lifetime.signal)
        if (lifetime.signal.aborted) return
        let aspect = 1.6
        if (snapshot.frame.kind === 'frame') {
          const image = new Image()
          image.src = snapshot.frame.imageUrl
          await image.decode()
          lifetime.signal.throwIfAborted()
          aspect = image.naturalWidth / image.naturalHeight
        }
        setView(current => ({ sessionId, failed: snapshot.frame.kind === 'unavailable',
          aspect: snapshot.frame.kind === 'unavailable' && current.sessionId === sessionId ? current.aspect : aspect,
          ...snapshot.frame.kind === 'unavailable' ? { failure: snapshot.frame.code } : {},
          snapshot: snapshot.frame.kind === 'unavailable' && current.sessionId === sessionId && current.snapshot?.frame.kind === 'frame'
            ? { ...snapshot, frame: current.snapshot.frame } : snapshot }))
        refreshMs = snapshot.refreshMs
      } catch (error) {
        if (!lifetime.signal.aborted) {
          console.error('Computer preview request failed:', error)
          setView(current => ({ sessionId, failed: true, aspect: current.sessionId === sessionId ? current.aspect : 1.6,
            ...current.sessionId === sessionId && current.snapshot !== undefined ? { snapshot: current.snapshot } : {} }))
        }
      }
      if (!lifetime.signal.aborted && refreshMs !== undefined) timer = setTimeout(() => { void read() }, refreshMs)
    }
    void read()
    return () => { lifetime.abort(); if (timer !== undefined) clearTimeout(timer) }
  }, [sessionId, collapsed, loadPreview, retry])
  const current = view.sessionId === sessionId ? view : undefined
  const frame = current?.snapshot?.frame
  const visible = frame !== undefined && frame.kind !== 'idle' || current?.failed
  const hasImage = frame?.kind === 'frame'
  const aspect = current?.aspect ?? 1.6
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight,
    top: 16 + (Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-top-clearance')) || 0) })
  const endDrag = (event?: PointerEvent<HTMLElement>) => {
    const drag = dragging.current
    if (event !== undefined && drag?.pointerId !== event.pointerId) return
    dragging.current = undefined
    if (drag?.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId)
  }
  useEffect(() => {
    if (!visible || collapsed || maximized) return
    const fit = () => { setLayout(value => value === undefined ? value : fitPreviewLayout(value, aspect, viewport())) }
    fit()
    window.addEventListener('resize', fit)
    return () => { window.removeEventListener('resize', fit); endDrag() }
  }, [visible, collapsed, maximized, aspect])
  const startDrag = (event: PointerEvent<HTMLButtonElement>, edge?: 'left' | 'right') => {
    if (maximized || event.button !== 0 || dragging.current !== undefined) return
    const rect = panel.current?.getBoundingClientRect()
    if (rect === undefined) return
    event.preventDefault()
    dragging.current = { pointerId: event.pointerId, element: event.currentTarget,
      x: event.clientX, y: event.clientY, start: { x: rect.left, y: rect.top, width: rect.width },
      ...edge === undefined ? {} : { edge } }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = dragging.current
    if (drag?.pointerId !== event.pointerId) return
    const delta = { x: event.clientX - drag.x, y: event.clientY - drag.y }
    setLayout(drag.edge === undefined
      ? fitPreviewLayout({ ...drag.start, x: drag.start.x + delta.x, y: drag.start.y + delta.y }, aspect, viewport())
      : resizePreviewLayout(drag.start, delta, drag.edge, aspect, viewport()))
  }
  const toggleMaximize = () => { endDrag(); setMaximized(value => !value) }
  const moveWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (maximized) return
    const delta = { ArrowLeft: { x: -24, y: 0 }, ArrowUp: { x: 0, y: -24 },
      ArrowRight: { x: 24, y: 0 }, ArrowDown: { x: 0, y: 24 } }[event.key]
    const rect = panel.current?.getBoundingClientRect()
    if (delta === undefined || rect === undefined) return
    event.preventDefault()
    event.stopPropagation()
    setLayout(fitPreviewLayout({ x: rect.left + delta.x, y: rect.top + delta.y, width: rect.width }, aspect, viewport()))
  }
  const style: CSSProperties & { '--preview-aspect': number; '--preview-top'?: string; '--preview-width'?: string } = {
    '--preview-aspect': aspect,
    ...layout === undefined || maximized && !collapsed ? {} : { left: layout.x, '--preview-top': `${layout.y}px`, right: 'auto',
      ...collapsed ? {} : { '--preview-width': `${layout.width}px` } },
  }
  const failed = current?.failed || frame?.kind === 'unavailable'
  const unavailable = current?.failure === 'PERMISSION_REQUIRED' ? 'previewPermissionRequired'
    : current?.failure === 'CAPTURE_TIMEOUT' ? 'previewTimeout' : current?.failure === 'IMAGE_TOO_LARGE' ? 'previewTooLarge' : 'previewUnavailable'
  const action = frame?.kind === 'frame' ? frame.action : ''
  const activity = action === 'type' ? 'previewType' : action === 'click' ? 'previewClick' : action === 'move' ? 'previewMove'
    : action === 'scroll-down' ? 'previewScrollDown' : action === 'scroll-up' ? 'previewScrollUp'
      : action === 'scroll-left' ? 'previewScrollLeft' : action === 'scroll-right' ? 'previewScrollRight'
        : action === 'key' ? 'previewKey' : action === 'observe' ? 'previewRead' : 'previewOther'
  const scrolling = action.startsWith('scroll-')
  const previewTitle = surface === 'browser' ? 'browserPreviewTitle' : 'previewTitle'
  const title = frame !== undefined && frame.kind !== 'idle' ? frame.title : t(previewTitle)
  return visible ? createPortal(<aside ref={panel} className={css.panel}
    aria-label={t(previewTitle)} data-computer-preview data-surface={surface} data-collapsed={collapsed || undefined}
    data-maximized={maximized && !collapsed || undefined}
    style={style} onPointerMove={moveDrag} onPointerUp={(event) => { moveDrag(event); endDrag(event) }}
    onPointerCancel={endDrag} onLostPointerCapture={endDrag}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && maximized) { event.stopPropagation(); setMaximized(false) }
    }}>
    {collapsed ? <button type="button" className={css.collapsedPreview} aria-label={t('previewExpand')}
      onClick={() => { setCollapsed(false) }}>
      <IconPanelLeftOutlineRegular size={16} />
      <span>{t(previewTitle)}</span>
      <IconChevronUpOutlineRegular size={14} />
    </button> : <>
      <div className={css.picture} data-stale={failed || undefined}>
        {hasImage ? <>
          <img src={frame.imageUrl} alt={t('previewImage')} draggable={false} />
          {frame.cursor === undefined ? null : <>
            <svg className={css.cursor} viewBox="0 0 32 32" aria-hidden
              data-pressed={frame.cursor.pressed || undefined}
              data-clicked={frame.cursor.pressed
                  || frame.cursor.clickAt !== undefined && Date.now() - frame.cursor.clickAt < 450 || undefined}
              style={{ left: `${frame.cursor.x * 100}%`, top: `${frame.cursor.y * 100}%` }}>
              <path d="M3 3 Q1 1 2 6 L9 27 Q10 30 12 26 L15 17 L25 13 Q29 11 25 9 Z" />
            </svg>
            {frame.cursor.clickAt === undefined || Date.now() - frame.cursor.clickAt > 450 ? null
              : <span key={frame.cursor.clickAt} className={css.clickRing} aria-hidden
                style={{ left: `${frame.cursor.x * 100}%`, top: `${frame.cursor.y * 100}%`,
                  animationDelay: `${-Math.max(0, Date.now() - frame.cursor.clickAt)}ms` }} />}
          </>}
          {frame.keyboard === undefined ? null : <span className={css.typing} aria-hidden>
            <svg className={css.keyboardIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="5" width="20" height="14" rx="3" />
              <path d="M5 9h2m2 0h2m2 0h2m2 0h2M5 12h2m2 0h2m2 0h2m2 0h2M7 15h10" />
            </svg>
            {frame.keyboard.kind === 'shortcut'
              ? frame.keyboard.keys.map((key, index) => <kbd key={`${index}:${key}`}>{key}</kbd>)
              : frame.keyboard.key === undefined ? null
                : <kbd>{frame.keyboard.key}</kbd>}
          </span>}
          {frame.scroll === undefined || frame.cursor === undefined ? null : <span className={css.scroll} aria-hidden
            style={{ left: `${Math.min(82, Math.max(4, frame.cursor.x * 100 + 6))}%`,
              top: `${Math.min(88, Math.max(5, frame.cursor.y * 100))}%` }}>
            <span className={css.wheel} /><span>{{ up: '↑', down: '↓', left: '←', right: '→' }[frame.scroll]}</span>
          </span>}
        </> : <div className={css.empty}>
          <IconPanelLeftOutlineRegular size={22} />
          <span>{t(unavailable)}</span>
        </div>}
      </div>
      <button className={css.handle} type="button" aria-label={t('previewDrag')} aria-description={title}
        onDoubleClick={toggleMaximize} onPointerDown={(event) => { startDrag(event) }} onKeyDown={moveWithKeyboard} />
      {hasImage && !maximized ? (['left', 'right'] as const).map(edge => <button key={edge} type="button"
        className={css.resize} data-resize-corner={edge} aria-label={t(edge === 'left' ? 'previewResizeLeft' : 'previewResizeRight')}
        aria-description={t('previewResizeHint')} onPointerDown={(event) => { startDrag(event, edge) }}
        onKeyDown={(event) => {
          const delta = { ArrowLeft: -24, ArrowUp: -24, ArrowRight: 24, ArrowDown: 24 }[event.key]
          if (delta === undefined) return
          const rect = panel.current?.getBoundingClientRect()
          if (rect === undefined) return
          event.preventDefault()
          event.stopPropagation()
          setLayout(fitPreviewLayout({ x: rect.left, y: rect.top, width: rect.width + delta }, aspect, viewport()))
        }} />) : null}
      <div className={css.controls}>
        <Tooltip label={t(maximized ? 'previewRestore' : 'previewEnlarge')} side="bottom" portal>
          <Button className={css.iconButton} size="sm" aria-label={t(maximized ? 'previewRestore' : 'previewEnlarge')}
            aria-pressed={maximized} onClick={toggleMaximize}>
            {maximized ? <IconCopyOutlineRegular size={16} /> : <IconFullscreenOutlineRegular size={16} />}
          </Button>
        </Tooltip>
      </div>
      <div className={`${css.controls} ${css.collapseControl}`}>
        <Tooltip label={t('previewCollapse')} side="bottom" portal>
          <Button className={css.iconButton} size="sm" aria-label={t('previewCollapse')} onClick={() => { setCollapsed(true) }}>
            <IconChevronDownOutlineRegular size={16} />
          </Button>
        </Tooltip>
      </div>
      {failed ? <div className={css.error} role="status">
        {hasImage ? <span>{t(unavailable)}</span> : null}
        <button className={css.retry} type="button" onClick={() => { setRetry(value => value + 1) }}>{t('previewRetry')}</button>
      </div> : hasImage && (frame.active || scrolling) ? <div className={css.caption}
        data-active={frame.active} aria-hidden={!frame.active}>
        <span className={css.activity} role="status"><span className={css.dot} />{t(activity)}</span>
      </div> : null}
    </>}
  </aside>, document.body) : null
}
