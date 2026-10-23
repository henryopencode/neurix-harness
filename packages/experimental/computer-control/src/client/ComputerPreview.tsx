/** Session-scoped, focus-preserving picture-in-picture for the current computer target. @module */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconCloseOutlineRegular,
  IconFullscreenOutlineRegular, IconPanelLeftOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComputerPreviewSnapshot } from '../preview-types.ts'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './ComputerPreview.module.css'

/** Cancellable display-only reader injected by the optional Remote contribution. */
export interface ComputerPreviewInjected {
  /**
   * @param sessionId - Session displayed by the header.
   * @param signal - this preview's viewing lifetime.
   * @returns the target image and Host-selected refresh interval.
   */
  loadPreview: (sessionId: SessionId, signal: AbortSignal) => Promise<ComputerPreviewSnapshot>
}

/** Header utilities supply the selected Session while the panel renders through a portal. */
export type ComputerPreviewProps = PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<'settings.computerControl'> & InjectFace<ComputerPreviewInjected>

/**
 * Display the actual target without activating it; closing or collapsing stops capture.
 * @param props - exact Session, read-only capture, and localized controls.
 * @returns the preview toggle and its optional floating panel.
 */
export function ComputerPreview({ sessionId, loadPreview, t }: ComputerPreviewProps) {
  const [open, setOpen] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [large, setLarge] = useState(false)
  const [retry, setRetry] = useState(0)
  const [view, setView] = useState<{
    sessionId: SessionId
    snapshot?: ComputerPreviewSnapshot
    failed: boolean
    failure?: Extract<ComputerPreviewSnapshot['frame'], { kind: 'unavailable' }>['code']
  }>({
    sessionId, failed: false,
  })
  const [position, setPosition] = useState<{ x: number; y: number }>()
  const panel = useRef<HTMLElement>(null)
  const dragging = useRef<{ x: number; y: number; left: number; top: number }>()
  useEffect(() => {
    if (!open || collapsed) return
    const lifetime = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setView(current => current.sessionId === sessionId ? current : { sessionId, failed: false })
    const read = async () => {
      let refreshMs: number | undefined
      try {
        const snapshot = await loadPreview(sessionId, lifetime.signal)
        if (lifetime.signal.aborted) return
        if (snapshot.frame.kind === 'frame') {
          const image = new Image()
          image.src = snapshot.frame.imageUrl
          await image.decode()
          lifetime.signal.throwIfAborted()
        }
        setView(current => ({ sessionId, failed: snapshot.frame.kind === 'unavailable',
          ...snapshot.frame.kind === 'unavailable' ? { failure: snapshot.frame.code } : {},
          snapshot: snapshot.frame.kind === 'unavailable' && current.sessionId === sessionId && current.snapshot?.frame.kind === 'frame'
            ? { ...snapshot, frame: current.snapshot.frame } : snapshot }))
        refreshMs = snapshot.refreshMs
      } catch (error) {
        if (!lifetime.signal.aborted) {
          console.error('Computer preview request failed:', error)
          setView(current => ({ sessionId, failed: true,
            ...current.sessionId === sessionId && current.snapshot !== undefined ? { snapshot: current.snapshot } : {} }))
        }
      }
      if (!lifetime.signal.aborted && refreshMs !== undefined) timer = setTimeout(() => { void read() }, refreshMs)
    }
    void read()
    return () => { lifetime.abort(); if (timer !== undefined) clearTimeout(timer) }
  }, [sessionId, open, collapsed, loadPreview, retry])
  useEffect(() => {
    const fit = () => { setPosition(current => current === undefined ? current : {
      x: Math.max(16, Math.min(current.x, window.innerWidth - (panel.current?.offsetWidth ?? 320) - 16)),
      y: Math.max(64, Math.min(current.y, window.innerHeight - (panel.current?.offsetHeight ?? 200) - 16)),
    }) }
    window.addEventListener('resize', fit)
    return () => { window.removeEventListener('resize', fit) }
  }, [])
  const current = view.sessionId === sessionId ? view : undefined
  const frame = current?.snapshot?.frame
  const visible = open && (frame !== undefined && frame.kind !== 'idle' || current?.failed)
  const hasImage = frame?.kind === 'frame'
  const failed = current?.failed || frame?.kind === 'unavailable'
  const unavailable = current?.failure === 'PERMISSION_REQUIRED' ? 'previewPermissionRequired'
    : current?.failure === 'CAPTURE_TIMEOUT' ? 'previewTimeout' : current?.failure === 'IMAGE_TOO_LARGE' ? 'previewTooLarge' : 'previewUnavailable'
  const action = frame?.kind === 'frame' ? frame.action : ''
  const activity = action === 'type' ? 'previewType' : action === 'click' ? 'previewClick' : action === 'move' ? 'previewMove'
    : action === 'scroll-down' ? 'previewScrollDown' : action === 'scroll-up' ? 'previewScrollUp'
      : action === 'scroll-left' ? 'previewScrollLeft' : action === 'scroll-right' ? 'previewScrollRight'
        : action === 'key' ? 'previewKey' : action === 'observe' ? 'previewRead' : 'previewOther'
  const scrolling = action.startsWith('scroll-')
  const title = frame !== undefined && frame.kind !== 'idle' ? frame.title : t('previewTitle')
  return <>
    <Tooltip label={t(visible ? 'previewHide' : 'previewShow')} side="bottom" portal>
      <Button size="sm" aria-label={t(visible ? 'previewHide' : 'previewShow')} aria-pressed={visible}
        onClick={() => { setOpen(!visible); setCollapsed(false); if (!visible) setRetry(value => value + 1) }}>
        <IconPanelLeftOutlineRegular size={18} />
      </Button>
    </Tooltip>
    {visible ? createPortal(<aside ref={panel} className={`${css.panel} ${large ? css.large : ''}`}
      aria-label={t('previewTitle')} data-computer-preview data-collapsed={collapsed || undefined}
      style={position === undefined ? undefined : { left: position.x, top: position.y, right: 'auto' }}>
      {collapsed ? <button type="button" className={css.collapsedPreview} aria-label={t('previewExpand')}
        onClick={() => { setCollapsed(false) }}>
        <IconPanelLeftOutlineRegular size={16} />
        <span>{t('previewTitle')}</span>
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
          onDoubleClick={() => { setLarge(value => !value); setPosition(undefined) }}
          onPointerDown={(event) => {
            const rect = panel.current?.getBoundingClientRect()
            if (rect === undefined) return
            dragging.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }
            event.currentTarget.setPointerCapture(event.pointerId)
          }} onPointerMove={(event) => {
            const drag = dragging.current
            if (drag === undefined) return
            setPosition({ x: Math.max(16, Math.min(window.innerWidth - (panel.current?.offsetWidth ?? 320) - 16,
              drag.left + event.clientX - drag.x)),
            y: Math.max(64, Math.min(window.innerHeight - (panel.current?.offsetHeight ?? 200) - 16,
              drag.top + event.clientY - drag.y)) })
          }} onPointerUp={() => { dragging.current = undefined }} onPointerCancel={() => { dragging.current = undefined }} />
        <div className={css.controls}>
          <Tooltip label={t('previewClose')} side="bottom" portal>
            <Button className={css.iconButton} size="sm" aria-label={t('previewClose')} onClick={() => { setOpen(false) }}>
              <IconCloseOutlineRegular size={18} />
            </Button>
          </Tooltip>
          <Tooltip label={t(large ? 'previewRestore' : 'previewEnlarge')} side="bottom" portal>
            <Button className={css.iconButton} size="sm" aria-label={t(large ? 'previewRestore' : 'previewEnlarge')}
              aria-pressed={large} onClick={() => { setLarge(value => !value); setPosition(undefined) }}>
              <IconFullscreenOutlineRegular size={16} />
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
    </aside>, document.body) : null}
  </>
}
