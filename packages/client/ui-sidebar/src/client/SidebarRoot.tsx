/**
 * Sidebar shell: a 56px icon rail beside the workspace/session browser.
 * Global panels and bottom-pinned Settings stay in icon mode at both widths.
 * Collapse freezes and fades the browser before restoring the compact stack;
 * desktop window-chrome controls retain their platform-specific placement.
 * The column also owns pointer-based scrollbar visibility for its descendants.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  FishLogo, IconEllipsisOutlineRegular, IconNewChatOutlineMedium, IconNewChatOutlineRegular, IconPanelLeftOutlineRegular,
  isDarwinDesktop, Menu, ShortcutKeys, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  SidebarPanelActionsOwnerProps, SidebarPanelMetadata, SidebarRootComponentProps, SidebarRootInjected,
} from './contract/slots.ts'
import { FIXED_PANEL_ID } from './panel-pins.ts'
import css from './SidebarRoot.module.css'

/** Covered-window fallback for the 300ms content and frame transition. */
const COLLAPSE_SETTLE_MS = 300

/**
 * How long the column's scrollbars stay drawn after the pointer leaves it.
 * The bar is a pointer affordance here, and hiding it on the leave event
 * itself makes it blink out while the pointer is only crossing the column's
 * edge — on the way to the conversation, or around a portalled menu.
 */
const SCROLLBAR_LINGER_MS = 2000

type PanelRowProps =
  Pick<SidebarPanelMetadata, 'id' | 'label'>
  & Pick<PropsRuntime<'sidebar'>, 'usePanelInfo'>
  & Pick<InjectFace<SidebarRootInjected>, 'selectPanel' | 'trackEntryClick'>
  & PropsRenderSlots<'sidebar.panellist'>

/** Analytics category of an official panel; other panels are never reported. */
function officialEntry(id: string): 'plugin' | 'cron' | undefined {
  if (id === 'plugins') return 'plugin'
  return id === 'schedules' ? 'cron' : undefined
}

/** Each panel row subscribes only to its own selection state. */
function PanelRow({ id, label, usePanelInfo, selectPanel, trackEntryClick, renderSlot }: PanelRowProps) {
  const active = usePanelInfo(info => info.activePanelId === id)
  return (
    <Tooltip label={label} delayMs={500} side="right">
      <button
        type="button"
        className={clsx(css.panelRow, active && css.panelActive)}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        onClick={() => {
          const entry = officialEntry(id)
          if (entry !== undefined) trackEntryClick({ menu_name: entry, position: 'sidebar' })
          selectPanel(id)
        }}
      >
        <span className={css.panelGlyph} aria-hidden="true">
          {renderSlot('sidebar.panellist', { size: 18, active }, { only: id })}
        </span>
      </button>
    </Tooltip>
  )
}

type PanelMoreMenuProps =
  Omit<SidebarPanelActionsOwnerProps, 'onDismiss'>
  & PropsRenderSlots<'sidebar.panellist.actions'>
  & Pick<InjectFace<SidebarRootInjected>, 'trackEntryClick'>
  & { readonly label: string }

/** The panel list's More launcher: a panel-row button whose menu rows come from `sidebar.panellist.actions`. */
function PanelMoreMenu({ label, entries, onOpen, onPinnedChange, trackEntryClick, renderSlot }: PanelMoreMenuProps) {
  const [open, setOpen] = useState(false)
  const onDismiss = (): void => { setOpen(false) }
  return (
    <Menu open={open} onClose={onDismiss} portal autoFocus className={css.moreAnchor} listClassName={css.moreMenu}
      anchor={(
        <Tooltip label={label} delayMs={500} side="right">
          <button type="button" className={css.panelRow} aria-label={label} aria-haspopup="menu" aria-expanded={open}
            onClick={() => {
              trackEntryClick({ menu_name: 'more', position: 'sidebar' })
              setOpen(value => !value)
            }}>
            <span className={css.panelGlyph} aria-hidden="true"><IconEllipsisOutlineRegular size={18} /></span>
          </button>
        </Tooltip>
      )}>
      {renderSlot('sidebar.panellist.actions', { entries, onOpen, onPinnedChange, onDismiss })}
    </Menu>
  )
}

/**
 * Render the sidebar column shell.
 * @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
 * @returns the sidebar element tree.
 */
export function SidebarRoot({
  collapsed,
  width,
  startSession,
  toggleSidebar,
  selectPanel,
  setPinned,
  trackEntryClick,
  useRemoteAccess,
  usePanels,
  useEntryPins,
  useEntryActions,
  useShortcuts,
  usePanelInfo,
  t,
  renderSlot,
}: SidebarRootComponentProps) {
  const panels = usePanels(snapshot => snapshot)
  const unpinned = useEntryPins(ids => ids)
  const activePanelId = usePanelInfo(info => info.activePanelId)
  const hasEntryActions = useEntryActions(registered => registered)
  const shortcut = useShortcuts(rows => rows.find(row => row.id === 'sidebar.left.toggle'))
  const newShortcut = useShortcuts(rows => rows.find(row => row.id === 'session.new'))
  // A page whose access snapshot excludes starting a Session offers no New Session affordance.
  const canStartSession = useRemoteAccess('session/create')
  const toggleLabel = collapsed ? t('toggle.open') : t('toggle.collapse')
  // Wide content stays mounted while the collapse animates (fading via
  // .collapsed .wide), unmounts at settle, and remounts right away on expand.
  const [settled, setSettled] = useState(collapsed)
  useEffect(() => {
    if (!collapsed) { setSettled(false); return }
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setSettled(true)
      return
    }
    const timer = window.setTimeout(() => { setSettled(true) }, COLLAPSE_SETTLE_MS)
    return () => { window.clearTimeout(timer) }
  }, [collapsed])
  const windowsTitlebar = document.documentElement.hasAttribute('data-windows-titlebar')
  const wide = !collapsed || !settled
  // The Windows titlebar hosts the New Session controls while the sidebar is collapsed.
  const openNewSession = (): void => {
    trackEntryClick({ menu_name: 'new_session', position: windowsTitlebar && collapsed ? 'titlebar' : 'sidebar' })
    startSession()
  }
  // The Windows caption menus occupy the strip to the right of these controls
  // (that is what --dsh-windows-menu-start reserves), so a right-side bubble
  // lands under their text. Below the caption is the only clear side.
  const captionTooltipSide = windowsTitlebar ? 'bottom' : 'right'
  // Freeze the content at its expanded width while it fades out (collapsed
  // && wide): the sliding column then clips it instead of reflowing it. The
  // rail layout (.collapsed styles) only applies once the fade settles.
  const lastWideWidth = useRef(width)
  if (!collapsed) lastWideWidth.current = width

  // Rail-in only crossfades a live collapse: a refresh straight into the
  // collapsed state renders the rail statically (no delay-hidden icons).
  const everWide = useRef(!collapsed)
  if (!collapsed) everWide.current = true

  // Scrollbars in the column follow the pointer (.quietBars rebinds them
  // away): drawn while it is inside, and for SCROLLBAR_LINGER_MS after it
  // leaves. A pointer that returns within that window cancels the pending
  // hide rather than restarting from a hidden bar.
  const column = useRef<HTMLDivElement>(null)
  const [pointerInside, setPointerInside] = useState(false)
  const lingerTimer = useRef<number | undefined>(undefined)
  const armLinger = (): void => {
    if (lingerTimer.current !== undefined) return
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined
      setPointerInside(false)
    }, SCROLLBAR_LINGER_MS)
  }
  const cancelLinger = (): void => {
    window.clearTimeout(lingerTimer.current)
    lingerTimer.current = undefined
  }
  // Leaving is decided by the column's BOX, not by DOM containment, and only
  // while the bars are drawn. ui-settings renders its full-viewport panel as a
  // fixed-position DESCENDANT of this column, so a pointer moved onto that
  // panel — or onto the conversation once it closes — fires no `pointerleave`
  // here, and the bars would stay drawn over a column nobody is pointing at.
  // The element's own leave stays as the one signal geometry cannot give: a
  // pointer that leaves the window emits no further moves.
  useEffect(() => {
    if (!pointerInside) return
    const onMove = (event: PointerEvent): void => {
      const rect = column.current?.getBoundingClientRect()
      /* v8 ignore next -- the listener only exists while the column is mounted and revealed. */
      if (rect === undefined) return
      const inside = event.clientX >= rect.left && event.clientX < rect.right
        && event.clientY >= rect.top && event.clientY < rect.bottom
      if (inside) cancelLinger()
      else armLinger()
    }
    document.addEventListener('pointermove', onMove)
    return () => {
      document.removeEventListener('pointermove', onMove)
      cancelLinger()
    }
  }, [pointerInside])

  const darwinDesktop = isDarwinDesktop()
  const toggle = (
    <Tooltip label={toggleLabel} shortcutKeys={shortcut?.keys} delayMs={500} side={captionTooltipSide}>
      <button
        type="button"
        className={clsx(css.iconButton, css.toggle)}
        aria-label={toggleLabel}
        aria-keyshortcuts={shortcut?.aria}
        onClick={() => { toggleSidebar() }}
      >
        {/* Rail icons render at 18 (figma rail spec); expanded keeps the glyph-native sizes. */}
        <IconPanelLeftOutlineRegular className={css.panelIcon} size={wide || windowsTitlebar ? 16 : 18} />
        {!wide && renderSlot('sidebar.toggle.badge', {})}
      </button>
    </Tooltip>
  )

  return (
    <div
      ref={column}
      className={clsx(
        css.root, !wide && css.collapsed, !wide && everWide.current && css.railIn,
        collapsed && wide && css.fading, !pointerInside && css.quietBars,
      )}
      style={wide ? { width: collapsed ? lastWideWidth.current : width } : undefined}
      onPointerEnter={() => {
        cancelLinger()
        setPointerInside(true)
      }}
      onPointerLeave={() => { armLinger() }}
    >
      {/* macOS hiddenInset titlebar: the strip shares the row with the
          traffic lights and keeps the toggle at the sidebar's top-right. */}
      {darwinDesktop && <div className={css.topStrip} data-window-drag>{toggle}</div>}
      <div className={css.logoRow} data-window-drag>
        {/* Expanded, the brand doubles as a New Session shortcut while the
            access snapshot allows `session/create` — except on
            macOS, where it stays part of the logo row's window-drag surface
            (a button would subtract itself through the global no-drag rule);
            the collapsed rail's logo is the expand toggle below instead. */}
        {wide && (() => {
          const identity = (
            <span className={css.brandIdentity} aria-hidden="true">
              <span className={css.brandName}>
                {renderSlot('sidebar.brand.name', {}, {
                  fallback: <span className={css.fallbackBrandName}>{t('brand.localBuild')}</span>,
                })}
              </span>
            </span>
          )
          return darwinDesktop || !canStartSession
            ? <span className={clsx(css.brand, css.wide)}>{identity}</span>
            : (
              <button
                type="button"
                className={clsx(css.brand, css.wide)}
                aria-label={t('session.new.label')}
                aria-keyshortcuts={newShortcut?.aria}
                onClick={openNewSession}
              >
                {identity}
              </button>
            )
        })()}
        {!darwinDesktop && toggle}
      </div>

      {/* The label fades before the hover/focus shortcut, including on translucent backgrounds. */}
      {canStartSession && (
        <Tooltip label={t('session.new.label')} shortcutKeys={newShortcut?.keys} delayMs={500} side={captionTooltipSide} disabled={wide}>
          <button
            type="button"
            className={css.newSession}
            aria-label={t('session.new.label')}
            aria-keyshortcuts={newShortcut?.aria}
            onClick={openNewSession}
          >
            <span className={css.newSessionLabelMask}><span className={css.newSessionContent}>
              {wide
                ? <IconNewChatOutlineMedium size={14} />
                : <IconNewChatOutlineRegular size={windowsTitlebar ? 16 : 18} />}
              {wide && <span className={clsx(css.newSessionLabel, css.wide)}>{t('session.new')}</span>}
            </span></span>
            {wide && newShortcut !== undefined && newShortcut.keys.length > 0 && <span className={css.newSessionShortcut} aria-hidden="true">
              <ShortcutKeys keys={newShortcut.keys} />
            </span>}
          </button>
        </Tooltip>
      )}

      <div className={css.navigationRail} data-sidebar-navigation>
        <Tooltip label={t('navigation.home')} delayMs={500} side="right">
          <button type="button" className={clsx(css.panelRow, activePanelId === null && css.panelActive)}
            aria-label={t('navigation.home')} aria-current={activePanelId === null ? 'page' : undefined}
            onClick={() => { selectPanel(null) }}>
            <span className={css.brandMark} aria-hidden="true">
              {renderSlot('sidebar.brand.mark', { size: 24 }, { fallback: <FishLogo size={24} /> })}
            </span>
          </button>
        </Tooltip>
        {panels.length > 0 && (
          <nav className={css.panelList} aria-label={t('panels.label')}>
            {panels.filter(({ id }) => id === FIXED_PANEL_ID || !unpinned.includes(id)).map(({ id, label }) => (
              <PanelRow
                key={id}
                id={id}
                label={label}
                usePanelInfo={usePanelInfo}
                selectPanel={selectPanel}
                trackEntryClick={trackEntryClick}
                renderSlot={renderSlot}
              />
            ))}
            {hasEntryActions && (
              <PanelMoreMenu
                label={t('panels.more')}
                entries={panels.filter(({ id }) => id !== FIXED_PANEL_ID)
                  .map(({ id, label }) => ({ id, label, pinned: !unpinned.includes(id), active: id === activePanelId }))}
                onOpen={(id) => {
                  const entry = officialEntry(id)
                  if (entry !== undefined) trackEntryClick({ menu_name: entry, position: 'sidebar_more' })
                  const panel = panels.find(candidate => candidate.id === id)
                  if (panel !== undefined) selectPanel(panel.id)
                }}
                onPinnedChange={setPinned}
                trackEntryClick={trackEntryClick}
                renderSlot={renderSlot}
              />
            )}
          </nav>
        )}
      </div>

      {/* The browser owns its full list and its collapsed expansion controls. */}
      <div className={css.regionArea} data-sidebar-browser onTransitionEnd={(event) => {
        if (collapsed && event.target === event.currentTarget && event.propertyName === 'opacity') setSettled(true)
      }}>
        {renderSlot('sidebar.workspaces', {
          wide,
          expandSidebar: () => { if (collapsed) toggleSidebar() },
        })}
      </div>

      {/* Footer actions stack above Settings in both sidebar widths. */}
      <div className={css.footArea} data-sidebar-footer>
        <div className={css.footerActions}>
          {renderSlot('sidebar.footer.action', { wide: false })}
        </div>
        <div className={css.settingsArea}>
          {renderSlot('sidebar.settings', { wide, compact: true })}
        </div>
      </div>
    </div>
  )
}
