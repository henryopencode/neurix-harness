/** Session-owned targets, page connections, observations, and input routing. @module */

import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, CDPSession, Dialog, Locator, Page } from 'playwright'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import { ComputerError, nativeActionResult } from './native.ts'
import type { NativeActionResult, NativeCalls, NativeResult } from './native.ts'
import { compactNativeState, nativeElementIdentity, nativeElementStateChanged, nativeWindowState } from './native-observation.ts'
import type { NativeElement, NativeWindowState } from './native-observation.ts'
import type { ComputerInput } from './schema.ts'
import type { ResolvedConfig } from './index.ts'
import { IndependentFeedback, characterLabel, typeCharacters, type ScreenRect } from './feedback.ts'
import { connectBrowserDialog, resolveBrowserDialog, type BrowserDialogConnection, type BrowserDialogWindow } from './browser-dialog.ts'
import { nativeWindows as windowList, resolveBrowserViewport } from './browser-window.ts'
import { backgroundBrowserAction } from './browser-input.ts'
import { captureBrowserScreenshot, cropBrowserPreview } from './browser-screenshot.ts'
import { observeBrowserFields } from './browser-fields.ts'
import { observeBrowserGeometry } from './browser-geometry.ts'
import { captureBrowserElements, requireBrowserElement, type BrowserObservedElements, type BrowserPinnedElement } from './browser-observation.ts'
import { foregroundAction } from './foreground.ts'
import { foregroundBrowserTarget } from './foreground-browser.ts'
import type { ComputerPreviewFrame } from './types.ts'

type TargetId = Branded<'ComputerTargetId'>
interface Observation {
  at: number
  screenshot: boolean
  refs: Set<string>
  bounds?: ScreenRect
  scaleX?: number
  scaleY?: number
  focusedEditable?: boolean
  pixels?: { width: number; height: number }
}
interface NativeObservation extends Observation {
  elements: Map<string, NativeElement>
  elementsComplete: boolean
  focus: 'accessibility' | 'window'
}
interface WindowTarget {
  kind: 'window'
  pid: number
  windowId: number
  title: string
  app: string
  observation?: NativeObservation
  unconfirmedClick?: NativeElement
}
type InputSettlement = { kind: 'completed' } | { kind: 'failed'; error: unknown }
interface PendingInput { done: Promise<InputSettlement>; dialog: PromiseWithResolvers<undefined> }
interface TabTarget {
  kind: 'tab'
  page: Page
  dialog?: Dialog
  dialogWindow?: BrowserDialogWindow
  dialogConnection?: Promise<{ connection: BrowserDialogConnection } | { error: unknown }>
  pending?: PendingInput
  observation?: Observation
  nativeViewport?: Awaited<ReturnType<typeof resolveBrowserViewport>>
  observedElements?: BrowserObservedElements
}
type Target = WindowTarget | TabTarget
type Address = Pick<Extract<ComputerInput, { action: 'click' }>, 'locator' | 'ref' | 'x' | 'y'>
type Content = NativeResult['content']
type TargetAction = Exclude<ComputerInput, { action: 'list' | 'open_app' | 'open_browser' | 'new_tab' | 'observe' | 'close_tab' | 'reset' }>

/** One Agent activation's browser and native lifecycle session. */
export class ComputerRuntime {
  private session = `dsh-${randomUUID()}`
  private readonly targets = new Map<TargetId, Target>()
  private nextId = 0
  private browser: Browser | undefined
  private context: BrowserContext | undefined
  private dialogCDP: Promise<CDPSession> | undefined
  private closing: Promise<void> | undefined
  private overflow: Promise<void> = Promise.resolve()
  private closedPopups = 0
  private readonly feedback: IndependentFeedback
  private browserInputActive = false
  private nativeUsed = false
  private inputMode: ResolvedConfig['inputMode']
  private previewImage: { target: TargetId; source: string; imageUrl: string; capturedAt: number } | undefined
  private preview: {
    target: TargetId
    action: string
    active: boolean
    feedbackUntil?: number
    dialogWindow?: BrowserDialogWindow
  } | undefined

  /**
   * @param native - provider-owned serialized native driver.
   * @param config - resolved deployment choices and resource limits.
   */
  constructor(private readonly native: NativeCalls | undefined, private readonly config: ResolvedConfig) {
    this.feedback = new IndependentFeedback(config)
    this.inputMode = config.inputMode
  }

  /**
   * Execute one operation and include fresh observation after successful input.
   * Canceled or failed input invalidates its observation and is never replayed.
   * @param input - validated operation with explicit defaults.
   * @param signal - active tool cancellation and deadline.
   * @param inputMode - user-selected mode captured for this operation; omission uses the initial setting.
   * @returns an MCP result for durable text and screenshot admission.
   */
  async execute(input: ComputerInput, signal: AbortSignal, inputMode = this.config.inputMode): Promise<NativeResult> {
    signal.throwIfAborted()
    if ('target' in input && this.targets.has(input.target as TargetId)) {
      this.preview = { ...this.preview?.target === input.target ? this.preview : {}, target: input.target as TargetId,
        action: input.action === 'scroll' ? `scroll-${input.direction}` : input.action, active: true, feedbackUntil: 0 }
      if (this.targets.get(input.target as TargetId)?.kind === 'tab' && input.action !== 'dialog') {
        delete this.preview.dialogWindow
      }
    }
    const deadline = new AbortController()
    const timeoutMs = input.action === 'open_app' || input.action === 'navigate' || input.action === 'open_browser' || input.action === 'new_tab'
      ? this.config.navigationTimeoutMs : this.config.operationTimeoutMs
    const timer = setTimeout(() => { deadline.abort(new DOMException(`${input.action} exceeded ${timeoutMs}ms`, 'TimeoutError')) }, timeoutMs)
    const active = AbortSignal.any([signal, deadline.signal])
    const usesBrowser = input.action === 'open_browser' || input.action === 'new_tab'
      || ('target' in input && this.targets.get(input.target as TargetId)?.kind === 'tab')
    const interruption: { kind: 'none' | 'read' | 'input'; done?: Promise<void> } = { kind: 'none' }
    const abort = () => {
      if (!usesBrowser || this.browser === undefined) return
      interruption.kind = this.browserInputActive ? 'input' : 'read'
      interruption.done = interruption.kind === 'read' ? this.stopBrowserLoading() : this.browser.close()
      // The operation's finally awaits this cleanup after Playwright settles.
      void interruption.done.catch(() => {})
    }
    active.addEventListener('abort', abort, { once: true })
    const run = async () => {
      this.inputMode = inputMode
      try { return await this.executeOperation(input, active) } catch (error) {
        await this.feedback.close()
        throw error
      }
    }
    try {
      const result = await (this.native === undefined ? run() : this.native.exclusive(input.action, active, run))
      signal.throwIfAborted()
      if (interruption.kind === 'read' && result.structuredContent?.browserStatus === 'open') return result
      active.throwIfAborted()
      return result
    } catch (error) {
      if (!usesBrowser && active.aborted && !(error instanceof ComputerError
        && (error.effect === 'none' || error.code === 'TIMEOUT' || error.code === 'CANCELED'))) {
        const reason: unknown = active.reason
        throw new ComputerError(deadline.signal.aborted ? 'TIMEOUT' : 'CANCELED',
          `${input.action}: ${reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'Computer input was canceled.'}`,
          error instanceof ComputerError ? error.effect : 'possible',
          'Observe the exact target before continuing. Input already delivered is not rolled back.')
      }
      if (usesBrowser && active.aborted) {
        const reason: unknown = active.reason
        throw new ComputerError(deadline.signal.aborted ? 'TIMEOUT' : 'CANCELED',
          `${input.action}: ${reason instanceof Error ? reason.message : String(reason)}`, 'possible',
          interruption.kind === 'read' ? 'The browser remains open. Observe the same target with screenshot: false. Do not reset or reopen it.'
            : 'List targets before continuing. Do not repeat interrupted input automatically.')
      }
      throw error
    } finally {
      if (this.preview !== undefined) {
        this.preview.active = false
        if ((this.preview.action.startsWith('scroll-') || this.preview.dialogWindow !== undefined) && !active.aborted) {
          this.preview.feedbackUntil = Date.now() + this.config.overlayIdleMs
        }
      }
      clearTimeout(timer)
      active.removeEventListener('abort', abort)
      try { await interruption.done } catch (error) {
        if (interruption.kind === 'read') throw new ComputerError('BROWSER_INTERRUPT_FAILED', `The browser remains open, but stopping page loading failed: ${this.message(error)}`,
          'possible', 'Observe the same tab before continuing. Do not reset or reopen the browser automatically.')
        this.closing = interruption.done
        throw new ComputerError('CLEANUP_FAILED', this.message(error), 'possible', 'Restart the host before reusing computer resources.')
      }
    }
  }

  private async executeOperation(input: ComputerInput, signal: AbortSignal): Promise<NativeResult> {
    await this.overflow
    signal.throwIfAborted()
    if (this.closing !== undefined) throw new ComputerError('CLOSING', 'Computer resources are closing.', 'none', 'Start a new Agent activation.')
    if (input.action === 'reset') {
      this.closing = this.reset(signal)
      await this.closing
      this.closing = undefined
      return this.result({ status: 'reset', targets: [] })
    }
    if (input.action === 'list') return this.list(input.query, signal)
    if (input.action === 'open_app') {
      this.requireNativeMode()
      const launched = await this.callNative('launch_app', { bundle_id: input.bundleId, input_mode: this.inputMode }, signal)
      try {
        const windows = windowList.parse(launched.structuredContent).windows
        const targets = this.rememberWindows(windows)
        const first = targets[0]
        if (first !== undefined) this.preview = { target: first.target, action: input.action, active: true }
        return this.result({ status: 'opened', launch: launched.structuredContent, targets, truncated: targets.length < windows.length })
      } catch (error) {
        throw new ComputerError('OBSERVATION_FAILED', `Application launch completed, but its windows could not be read: ${this.message(error)}`,
          'completed', 'List targets to discover the launched application. Do not repeat open_app automatically.')
      }
    }
    if (input.action === 'open_browser' || input.action === 'new_tab') {
      if (input.url !== undefined) this.validateUrl(input.url)
      if (input.action === 'new_tab') this.tab(this.target(input.target))
      const context = await this.browserContext(signal)
      signal.throwIfAborted()
      this.checkCapacity()
      const page = await context.newPage()
      const id = this.addTab(page)
      const target = this.target(id)
      this.preview = { target: id, action: input.action, active: true }
      try {
        if (target.kind === 'tab') await this.dialogConnection(target)
        if (input.url !== undefined) await this.runBrowserAction(this.tab(target), { action: 'navigate', target: id, url: input.url }, signal)
        return await this.observe(id, target, input.screenshot ?? this.config.screenshots, signal)
      } catch (error) {
        if (page.isClosed()) throw new ComputerError('BROWSER_CLOSED', `The browser closed after creating ${id}: ${this.message(error)}`, 'possible', 'Report that the browser closed. Do not repeatedly reopen it or try other sites automatically.')
        if (!signal.aborted || signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') {
          return this.result({ status: 'partial', target: id, kind: 'tab', browserStatus: 'open', url: page.url(),
            warnings: [{ code: signal.aborted ? 'TIMEOUT' : 'NAVIGATION_FAILED', message: this.message(error) }],
            nextAction: `The browser and ${id} are open. Observe this same target with screenshot: false; do not reset or open another browser.` })
        }
        throw error
      }
    }
    const id = input.target as TargetId
    const target = this.target(id)
    if (target.kind === 'window') this.requireNativeMode()
    if (this.inputMode === 'background' && target.kind === 'window' && target.unconfirmedClick === undefined
      && (input.action === 'click' || input.action === 'type') && input.ref === undefined
      && (input.x !== undefined || input.y !== undefined)) {
      throw new ComputerError('BACKGROUND_PIXEL_UNAVAILABLE',
        'The native pixel click and typing route can activate the application, so it is unavailable in background mode.',
        'none', 'Use an element_token as ref from this window. If its accessibility route is unsupported, stop and ask the user to select Foreground system input explicitly.')
    }
    if (input.action === 'observe') return this.observe(id, target, input.screenshot ?? this.config.screenshots, signal, input.query)
    if (input.action === 'close_tab') {
      const tab = this.tab(target)
      await tab.page.close({ runBeforeUnload: false })
      this.targets.delete(id)
      return this.result({ status: 'closed', target: id })
    }
    const requestedScreenshot = input.screenshot ?? this.config.screenshots
    let completed = false
    try {
      if (input.action !== 'navigate' && (target.kind === 'window' || this.nativeDialogFeedback())) {
        await this.startNativeSession(signal, this.config.operationTimeoutMs)
      }
      const grounded = await this.renewNativeRef(id, target, input, signal)
      if (input.action !== 'navigate') this.requireObservation(target, grounded)
      let action: NativeActionResult | undefined
      if (target.kind === 'tab') await this.runBrowserAction(target, grounded, signal)
      else {
        if (this.inputMode === 'background' && target.unconfirmedClick !== undefined) throw new ComputerError(
          'BACKGROUND_EFFECT_UNCONFIRMED', 'The previous background click has no confirmed effect. Further input to this window is blocked.',
          'none', 'Select Foreground system input in Computer Control settings, save, and continue this conversation. Observation remains available.')
        action = nativeActionResult(await this.windowAction(target, grounded, signal))
        if (this.inputMode === 'background' && action !== undefined && action.effect !== 'confirmed'
          && grounded.action === 'click' && grounded.ref !== undefined) {
          const element = target.observation?.elements.get(grounded.ref)
          if (element !== undefined && !['AXTextField', 'AXTextArea', 'AXSearchField', 'AXComboBox'].includes(String(element.role))) {
            const identity = nativeElementIdentity(element)
            if (identity !== undefined) target.unconfirmedClick = element
          }
        }
      }
      completed = true
      signal.throwIfAborted()
      return await this.observe(id, target, requestedScreenshot, signal, undefined, action)
    } catch (error) {
      if (error instanceof ComputerError && error.effect === 'none' && !completed) throw error
      delete target.observation
      if (error instanceof ComputerError && !completed) throw error
      throw new ComputerError(completed ? 'OBSERVATION_FAILED' : 'ACTION_FAILED',
        `${input.action} on ${id}: ${this.message(error)}`, completed ? 'completed' : 'possible',
        `Observe ${id} before deciding whether another action is needed. Input already delivered is not rolled back.`)
    }
  }

  /**
   * Close only owned browsers and the native lifecycle session; leave user apps running.
   * @returns quiescent cleanup; failed cleanup prevents resource reuse.
   */
  close(): Promise<void> {
    return this.closing ??= this.reset(AbortSignal.timeout(this.config.operationTimeoutMs))
  }

  /**
   * Capture only the latest target for the preview UI. Native display-only reads
   * preserve action screenshots and accessibility tokens. Failure never closes
   * a browser, activates a window, or changes model-visible observations. During
   * native input, pixel-only reads bypass the reserved input workflow without changing action tokens.
   * @param signal - preview reader cancellation and contribution lifetime.
   * @returns a bounded PNG, an idle state, or a display-only capture failure.
   */
  async capturePreview(signal: AbortSignal): Promise<ComputerPreviewFrame> {
    return this.readPreview(signal)
  }

  private async readPreview(signal: AbortSignal, refreshNative = false): Promise<ComputerPreviewFrame> {
    const current = this.preview
    if (current === undefined || this.closing !== undefined) return { kind: 'idle' }
    const target = this.targets.get(current.target)
    if (target === undefined) return { kind: 'idle' }
    const indicatorActive = current.active || current.feedbackUntil !== undefined && current.feedbackUntil > Date.now()
    const viewport = target.kind === 'tab' ? target.nativeViewport : undefined
    const native = target.kind === 'window' ? target
      : target.dialogWindow ?? (indicatorActive ? current.dialogWindow : undefined) ?? viewport
    const timeoutMs = native !== undefined && this.native?.previewReady === false
      ? this.config.operationTimeoutMs : this.config.previewTimeoutMs
    const active = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    const title = target.kind === 'window' ? `${target.app} — ${target.title}` : target.page.url()
    const visual = this.feedback.preview(current.target)
    const decorate = (imageUrl: string, capturedAt: number): ComputerPreviewFrame => ({ kind: 'frame', title,
      imageUrl, capturedAt, active: current.active || visual.active
        || current.feedbackUntil !== undefined && current.feedbackUntil > Date.now(),
      action: visual.active && visual.action !== undefined ? visual.action : current.action,
      ...visual.cursor === undefined ? {} : { cursor: visual.cursor },
      ...visual.keyboard === undefined ? {} : { keyboard: visual.keyboard },
      ...visual.scroll === undefined ? {} : { scroll: visual.scroll },
    })
    try {
      active.throwIfAborted()
      const source = native === undefined ? 'page' : `window-${native.pid}-${native.windowId}-${target.kind === 'tab' ? JSON.stringify('bounds' in native ? native.bounds : undefined) : ''}`
      const retained = this.previewImage
      if (!refreshNative && !current.active && current.dialogWindow !== undefined && indicatorActive
        && retained?.target === current.target && retained.source === source) {
        return decorate(retained.imageUrl, retained.capturedAt)
      }
      let image: Buffer
      if (native === undefined && target.kind === 'tab' && this.foregroundBrowser() && current.active) {
        return retained?.target === current.target ? decorate(retained.imageUrl, retained.capturedAt)
          : { kind: 'unavailable', title, code: 'CAPTURE_FAILED' }
      }
      if (target.kind === 'tab' && target.dialog !== undefined && native === undefined) return { kind: 'unavailable', title, code: 'CAPTURE_FAILED' }
      if (native === undefined && target.kind === 'tab') image = await captureBrowserScreenshot(target.page, active, this.config.previewTimeoutMs,
        this.config.previewMaxDimension, await this.dialogConnection(target))
      else {
        if (native === undefined) return { kind: 'unavailable', title, code: 'CAPTURE_FAILED' }
        const captureArgs = { pid: native.pid,
          window_id: 'captureWindowId' in native ? native.captureWindowId : native.windowId,
          session: this.session, max_dimension: this.config.previewMaxDimension }
        const result = await this.requireNative().capture(captureArgs, active, timeoutMs)
        const block = result.content.find(item => item.type === 'image')
        if (block?.type !== 'image') return { kind: 'unavailable', title, code: 'CAPTURE_FAILED' }
        image = Buffer.from(block.data, 'base64')
        if (viewport !== undefined && native === viewport) image = await cropBrowserPreview(image, viewport.bounds, viewport.content)
      }
      if (image.byteLength > this.config.previewMaxBytes) return { kind: 'unavailable', title, code: 'IMAGE_TOO_LARGE' }
      active.throwIfAborted()
      const imageUrl = `data:image/png;base64,${image.toString('base64')}`
      const capturedAt = Date.now()
      this.previewImage = { target: current.target, source, imageUrl, capturedAt }
      return decorate(imageUrl, capturedAt)
    } catch (error) {
      signal.throwIfAborted()
      const code = error instanceof ComputerError && ['permission_required', 'screen_recording_required', 'accessibility_required'].includes(error.code)
        ? 'PERMISSION_REQUIRED' : active.aborted ? 'CAPTURE_TIMEOUT' : 'CAPTURE_FAILED'
      return { kind: 'unavailable', title, code }
    }
  }

  private async reset(signal: AbortSignal): Promise<void> {
    const pending = [...this.targets.values()]
      .flatMap(target => target.kind === 'tab' && target.pending !== undefined ? [target.pending.done] : [])
    const outcomes = await Promise.allSettled([
      this.browser?.close(),
      !this.nativeUsed ? undefined : this.callNative('end_session', { session: this.session }, signal),
      this.feedback.close(),
    ])
    await Promise.all([...pending, this.overflow])
    const errors: unknown[] = []
    for (const outcome of outcomes) if (outcome.status === 'rejected') errors.push(outcome.reason)
    if (errors.length > 0) throw new AggregateError(errors, 'Computer cleanup failed; restart the host before reusing these resources.')
    this.browser = undefined
    this.context = undefined
    this.dialogCDP = undefined
    this.targets.clear()
    this.preview = undefined
    this.previewImage = undefined
    this.closedPopups = 0
    this.session = `dsh-${randomUUID()}`
    this.nativeUsed = false
  }

  private async browserContext(signal: AbortSignal): Promise<BrowserContext> {
    if (this.context !== undefined) return this.context
    signal.throwIfAborted()
    const browser = await chromium.launch({
      headless: this.config.headless,
      args: ['--force-renderer-accessibility'],
      ...this.config.browserExecutablePath === undefined
        ? { channel: this.config.browserChannel }
        : { executablePath: this.config.browserExecutablePath },
      timeout: this.config.navigationTimeoutMs,
      env: scrubbedParentEnv(),
    })
    this.browser = browser
    browser.on('disconnected', () => {
      this.browserDisconnected(browser)
    })
    try {
      signal.throwIfAborted()
      if (this.nativeDialogFeedback()) this.dialogCDP = Promise.resolve(await browser.newBrowserCDPSession())
      const context = await browser.newContext({ viewport: null, acceptDownloads: false })
      signal.throwIfAborted()
      context.setDefaultTimeout(this.config.operationTimeoutMs)
      context.setDefaultNavigationTimeout(this.config.navigationTimeoutMs)
      context.on('page', (page) => {
        if (this.targets.size < this.config.maxTargets) {
          this.addTab(page)
          return
        }
        this.closedPopups++
        this.overflow = Promise.all([this.overflow, page.close()]).then(() => {})
        // Tool admission and resource cleanup own this callback's settlement.
        void this.overflow.catch(() => {})
      })
      this.context = context
      return context
    } catch (error) {
      await browser.close()
      this.browser = undefined
      throw error
    }
  }

  private addTab(page: Page): TargetId {
    for (const [id, target] of this.targets) if (target.kind === 'tab' && target.page === page) return id
    const id = `tab-${++this.nextId}` as TargetId
    const target: TabTarget = { kind: 'tab', page }
    if (this.dialogCDP !== undefined) target.dialogConnection = this.dialogCDP.then(cdp => connectBrowserDialog(page, cdp))
      .then(connection => ({ connection }), (error: unknown) => ({ error }))
    this.targets.set(id, target)
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) delete target.observation
    })
    page.on('dialog', (dialog) => { delete target.dialogWindow; target.dialog = dialog; target.pending?.dialog.resolve(undefined) })
    page.on('close', () => { this.targets.delete(id) })
    return id
  }

  private async list(query: string | undefined, signal: AbortSignal): Promise<NativeResult> {
    const [permissions, windows] = !this.nativeEnabled() ? [
      { structuredContent: { status: 'unavailable', reason: this.native === undefined
        ? 'Native desktop access requires macOS.' : 'Browser background mode does not include desktop applications. Select Foreground system input to use them.' } },
      { structuredContent: { windows: [] } },
    ] : await Promise.all([
      this.callNative('check_permissions', { prompt: false }, signal),
      this.callNative('list_windows', { on_screen_only: false }, signal),
    ])
    const live = windowList.parse(windows.structuredContent).windows
    for (const [id, target] of this.targets) {
      if (target.kind === 'window' && !live.some(window => window.pid === target.pid && window.window_id === target.windowId)) this.targets.delete(id)
    }
    this.rememberWindows(live)
    const targets = []
    for (const [id, target] of this.targets) {
      const summary = target.kind === 'window'
        ? { target: id, kind: target.kind, app: target.app, title: target.title, pid: target.pid, windowId: target.windowId }
        : {
          target: id, kind: target.kind, url: target.page.url(),
          ...target.dialog === undefined ? {} : { dialog: { type: target.dialog.type(), message: target.dialog.message() } },
        }
      if (query === undefined || JSON.stringify(summary).toLowerCase().includes(query.toLowerCase())) targets.push(summary)
    }
    return this.result({
      status: 'listed', permissions: permissions.structuredContent, targets, truncated: live.length > this.config.maxTargets,
    })
  }

  private rememberWindows(windows: z.infer<typeof windowList>['windows']) {
    const targets = []
    for (const window of windows) {
      const current = [...this.targets].find((entry): entry is [TargetId, WindowTarget] => entry[1].kind === 'window' && entry[1].pid === window.pid && entry[1].windowId === window.window_id)
      if (current === undefined && this.targets.size >= this.config.maxTargets) continue
      const id = current?.[0] ?? `window-${++this.nextId}` as TargetId
      const target: WindowTarget = current?.[1] ?? { kind: 'window', pid: window.pid, windowId: window.window_id, title: '', app: '' }
      target.title = window.title ?? ''; target.app = window.app_name ?? ''
      this.targets.set(id, target)
      targets.push({ target: id, kind: target.kind, app: target.app, title: target.title, pid: target.pid, windowId: target.windowId })
    }
    return targets
  }

  private async observe(id: TargetId, target: Target, screenshot: boolean, signal: AbortSignal, query?: string,
    actionResult?: NativeActionResult): Promise<NativeResult> {
    const observedAt = Date.now()
    delete target.observation
    if (target.kind === 'tab') {
      await target.observedElements?.dispose()
      delete target.observedElements
    }
    signal.throwIfAborted()
    if (target.kind === 'window') {
      const result = await this.callNative('get_window_state', {
        session: this.session, pid: target.pid, window_id: target.windowId, include_screenshot: screenshot,
        tree_format: 'elements',
        timeout_ms: this.config.nativeTreeTimeoutMs,
        ...query === undefined ? {} : { query },
        max_elements: this.config.maxElements, max_depth: this.config.maxDepth, max_dimension: this.config.maxScreenshotDimension,
        full_output: this.config.showOverlay || this.inputMode === 'foreground',
      }, signal)
      const data = nativeWindowState.parse(result.structuredContent)
      if (target.unconfirmedClick !== undefined && query === undefined) {
        const identity = nativeElementIdentity(target.unconfirmedClick)
        if (nativeElementStateChanged(target.unconfirmedClick, data.elements ?? [])
          || data.elements_complete === true && !data.elements?.some(element => nativeElementIdentity(element) === identity)) {
          delete target.unconfirmedClick
        }
      }
      const images = result.content.filter(block => block.type === 'image')
      const bounds = data.window_bounds ?? (!this.config.showOverlay && this.inputMode !== 'foreground' ? undefined
        : windowList.parse((await this.callNative('list_windows', { pid: target.pid, on_screen_only: false }, signal)).structuredContent).windows
          .find(window => window.window_id === target.windowId && window.pid === target.pid)?.bounds)
      const view = compactNativeState(data)
      const response = this.nativeResult(id, view, images, actionResult,
        this.inputMode === 'background' && target.unconfirmedClick !== undefined)
      const refs = new Set(view.elements.flatMap(element => element.element_token === undefined ? [] : [element.element_token]))
      target.observation = {
        at: Date.now(), screenshot: images.length > 0,
        ...data.screenshot_width == null || data.screenshot_height == null ? {} : {
          pixels: { width: data.screenshot_width, height: data.screenshot_height },
        },
        focus: data.background_input?.exact_window?.status === 'ax_unresolved' ? 'window' : 'accessibility',
        refs,
        elementsComplete: view.elements_complete === true,
        ...bounds === undefined ? {} : { bounds,
          scaleX: (data.screenshot_width ?? bounds.width) / bounds.width,
          scaleY: (data.screenshot_height ?? bounds.height) / bounds.height },
        elements: new Map(data.elements?.flatMap(element => element.element_token === undefined || !refs.has(element.element_token)
          ? [] : [[element.element_token, element]])),
      }
      return response
    }
    if (target.dialog !== undefined) {
      let warning: { code: string; message: string } | undefined
      if (this.nativeDialogFeedback()) {
        try {
          target.dialogWindow = await this.resolveDialog(target, signal)
        } catch (error) {
          delete target.dialogWindow
          signal.throwIfAborted()
          warning = { code: 'DIALOG_FEEDBACK_UNAVAILABLE', message: this.message(error) }
        }
      }
      return this.result({ status: 'dialog', target: id, kind: 'tab', url: target.page.url(),
        dialog: { type: target.dialog.type(), message: target.dialog.message(), defaultValue: target.dialog.defaultValue() },
        ...warning === undefined ? {} : { warnings: [warning] } })
    }
    const [state, capture, heading, fields, geometry] = await Promise.allSettled([
      target.page.locator('body').ariaSnapshot({ timeout: this.config.operationTimeoutMs }),
      screenshot ? this.dialogConnection(target).then(connection => captureBrowserScreenshot(
        target.page, signal, this.config.operationTimeoutMs, undefined, connection))
        : Promise.resolve(undefined),
      target.page.title(),
      observeBrowserFields(target.page, this.config.maxElements, this.config.maxSnapshotChars),
      observeBrowserGeometry(target.page, this.config.maxElements),
    ])
    if (target.page.isClosed()) throw new ComputerError('BROWSER_CLOSED', 'The browser tab closed while reading its state.', 'none', 'Report the closed tab. Do not repeatedly reopen the browser automatically.')
    const warnings: Array<{ code: string; message: string }> = []
    const tree = state.status === 'fulfilled' ? state.value : undefined
    if (state.status === 'rejected') warnings.push({ code: 'PAGE_STATE_UNAVAILABLE', message: this.message(state.reason) })
    const images: Content = []
    if (capture.status === 'fulfilled' && capture.value !== undefined) images.push({ type: 'image', data: capture.value.toString('base64'), mimeType: 'image/png' })
    if (capture.status === 'rejected') warnings.push({ code: 'SCREENSHOT_FAILED', message: this.message(capture.reason) })
    if (heading.status === 'rejected') warnings.push({ code: 'TITLE_UNAVAILABLE', message: this.message(heading.reason) })
    if (fields.status === 'rejected') warnings.push({ code: 'FIELDS_UNAVAILABLE', message: this.message(fields.reason) })
    if (geometry.status === 'rejected') warnings.push({ code: 'GEOMETRY_UNAVAILABLE', message: this.message(geometry.reason) })
    const selectors = [
      ...geometry.status === 'fulfilled' ? geometry.value.elements.map(element => element.locator.selector) : [],
      ...fields.status === 'fulfilled' ? fields.value.flatMap(field => field.locator === undefined ? [] : [field.locator.selector]) : [],
    ]
    try { target.observedElements = await captureBrowserElements(target.page, selectors) } catch (error) {
      warnings.push({ code: 'ELEMENTS_UNAVAILABLE', message: this.message(error) })
    }
    if (signal.aborted) warnings.push({ code: 'TIMEOUT', message: 'Reading this page exceeded the operation deadline; its browser remains open.' })
    if (tree !== undefined || images.length > 0) target.observation = { at: observedAt, screenshot: images.length > 0, refs: new Set(),
      ...geometry.status === 'fulfilled' ? { pixels: geometry.value.viewport } : {},
      focusedEditable: fields.status === 'fulfilled' && fields.value.some(field => field.focused) }
    return this.result({
      status: tree === undefined ? 'partial' : 'observed', target: id, kind: 'tab', browserStatus: 'open', url: target.page.url(),
      ...heading.status === 'fulfilled' ? { title: heading.value } : {},
      ...fields.status === 'fulfilled' ? { fields: fields.value } : {},
      ...geometry.status === 'fulfilled' ? { geometry: geometry.value } : {},
      ...tree === undefined ? {} : { tree: tree.slice(0, this.config.maxSnapshotChars),
        truncated: tree.length > this.config.maxSnapshotChars },
      ...warnings.length === 0 ? {} : { warnings,
        nextAction: `The browser and ${id} are open. Use the returned page state, or observe this same target with screenshot: false. Do not reset or reopen the browser.` },
    }, images)
  }

  private async browserAction(target: TabTarget, input: Exclude<ComputerInput, { action: 'list' | 'open_app' | 'open_browser' | 'new_tab' | 'observe' | 'close_tab' | 'reset' }>, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (target.dialog !== undefined && input.action !== 'dialog') throw new ComputerError('DIALOG_OPEN', 'A page dialog blocks this tab.', 'none', 'Use dialog with an explicit accept choice before continuing.')
    if (input.action !== 'navigate' && input.action !== 'dialog' && input.action !== 'menu') {
      const address = this.resolveBrowserLocator(target, input)
      if (input.action !== 'key' && address === undefined && 'x' in input && input.x !== undefined) this.requirePixels(target, input)
      if (input.action === 'drag' && input.toLocator === undefined) this.requirePixels(target, { x: input.toX, y: input.toY })
      const drop = input.action === 'drag' && input.toLocator !== undefined
        ? this.browserLocator(target.page, { locator: input.toLocator }) : undefined
      let location: BrowserPinnedElement | undefined, destination: BrowserPinnedElement | undefined
      try {
        if (address !== undefined) location = await requireBrowserElement(address, target.observedElements,
          input.action === 'type' && input.locator === undefined)
        if (drop !== undefined) destination = await requireBrowserElement(drop, target.observedElements)
        if (this.foregroundBrowser()) {
          await target.page.bringToFront()
          const connection = await this.dialogConnection(target)
          if (connection === undefined) throw new ComputerError('WINDOW_REQUIRED', 'The owned browser window is unavailable.',
            'none', 'Observe the same target before continuing.')
          const read = (name: string, args: Record<string, unknown>, active: AbortSignal) =>
            this.callNative(name, { ...args, session: this.session }, active)
          const window = await resolveBrowserViewport(connection, target.page, read, this.config, signal)
          target.nativeViewport = window
          const native = await foregroundBrowserTarget(target.page, input, location, destination, window, this.config, signal)
          await foregroundAction(native, input, this.config, this.feedback, read, signal)
          await target.page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
          return
        }
        let display: ((event: import('./feedback.ts').WindowFeedbackEvent) => Promise<void>) | undefined
        if (this.nativeDialogFeedback()) {
          const connection = await this.dialogConnection(target)
          if (connection === undefined) throw new ComputerError('WINDOW_FEEDBACK_UNAVAILABLE',
            'The owned browser window identity is unavailable.', 'none', 'Observe the same target before continuing.')
          const at = await resolveBrowserViewport(connection, target.page,
            (name, args, active) => this.callNative(name, { ...args, session: this.session }, active), this.config, signal)
          this.feedback.select(input.target, at.windowId, at.bounds, at.content, at.desktopVisible)
          display = event => this.feedback.update({ ...event,
            ...event.x === undefined || event.y === undefined ? {} : {
              x: at.content.x + event.x * at.content.width / at.viewport.width,
              y: at.content.y + event.y * at.content.height / at.viewport.height,
            },
          }, signal)
        }
        await backgroundBrowserAction(target.page, input, location, this.config, signal,
          work => this.dispatchBrowserInput(work), destination, display)
        return
      } finally {
        await Promise.all([location?.dispose(), destination?.dispose()])
      }
    }
    switch (input.action) {
      case 'navigate':
        this.validateUrl(input.url)
        await target.page.goto(input.url, { waitUntil: 'commit', timeout: this.config.navigationTimeoutMs })
        return
      case 'dialog': {
        const dialog = target.dialog
        if (dialog === undefined) throw new ComputerError('NO_DIALOG', 'This tab has no pending page dialog.', 'none', 'Observe the tab before continuing.')
        // Resolving a native dialog always stays in the nonactivating AX path.
        // The page action that opened it may use another mode, but this action
        // must not move the physical pointer, change focus, or raise the window.
        if (this.nativeDialogFeedback()) await this.dialogFeedback(target, dialog, input, signal)
        await this.dispatchBrowserInput(() => input.accept ? dialog.accept(input.text) : dialog.dismiss())
        delete target.dialog
        delete target.dialogWindow
        const pending = target.pending
        if (pending !== undefined) {
          const outcome = await pending.done
          delete target.pending
          if (outcome.kind === 'failed') throw outcome.error
        }
        return
      }
      case 'menu': throw new ComputerError('WINDOW_REQUIRED', 'Application menus require a native window target.', 'none', 'List windows and choose the exact application window.')
      /* v8 ignore next -- operations are parsed from the closed tool argument union. */
      default: return assertNever(input, 'browser action')
    }
  }

  private resolveBrowserLocator(target: TabTarget, input: Parameters<ComputerRuntime['browserAction']>[1]): Locator | undefined {
    if (input.action === 'key' || input.action === 'navigate' || input.action === 'dialog' || input.action === 'menu') return undefined
    const locator = this.browserLocator(target.page, input)
    if (input.action === 'type' && locator === undefined && input.x === undefined && input.y === undefined && target.observation?.focusedEditable) return target.page.locator(':focus')
    return locator
  }

  private async dispatchBrowserInput<T>(work: () => Promise<T>): Promise<T> {
    this.browserInputActive = true
    try { return await work() } finally { this.browserInputActive = false }
  }

  private async runBrowserAction(target: TabTarget, input: Parameters<ComputerRuntime['browserAction']>[1], signal: AbortSignal): Promise<void> {
    this.browserInputActive = false
    try { await this.settleBrowserAction(target, input, signal) } finally { this.browserInputActive = false }
  }

  private foregroundBrowser(): boolean { return process.platform === 'darwin' && !this.config.headless && this.inputMode === 'foreground' }

  private nativeDialogFeedback(): boolean { return this.foregroundBrowser() || process.platform === 'darwin' && !this.config.headless && this.config.showOverlay }

  private async resolveDialog(target: TabTarget, signal: AbortSignal): Promise<BrowserDialogWindow> {
    const dialog = target.dialog
    if (dialog === undefined) throw new ComputerError('NO_DIALOG', 'This tab has no pending page dialog.', 'none', 'Observe the tab before continuing.')
    try {
      await this.startNativeSession(signal, this.config.operationTimeoutMs)
      const connection = await this.dialogConnection(target)
      if (connection === undefined) throw new Error('The browser dialog connection is unavailable.')
      const read = (name: string, args: Record<string, unknown>, active: AbortSignal) =>
        this.callNative(name, { ...args, session: this.session }, active)
      try { return await resolveBrowserDialog(connection, dialog, read, this.config, signal) } catch (error) {
        if (!(error instanceof ComputerError) || error.code !== 'DIALOG_FEEDBACK_UNAVAILABLE') throw error
        await delay(100, undefined, { signal })
        return await resolveBrowserDialog(connection, dialog, read, this.config, signal)
      }
    } catch (error) {
      if (error instanceof ComputerError) throw error
      signal.throwIfAborted()
      throw new ComputerError('DIALOG_FEEDBACK_UNAVAILABLE', this.message(error), 'none', 'Observe the same tab and check native window access. No dialog input was sent.')
    }
  }

  private async dialogConnection(target: TabTarget): Promise<BrowserDialogConnection | undefined> {
    if (target.dialogConnection === undefined && this.nativeDialogFeedback() && this.browser !== undefined) {
      this.dialogCDP ??= this.browser.newBrowserCDPSession()
      target.dialogConnection = this.dialogCDP.then(cdp => connectBrowserDialog(target.page, cdp))
        .then(connection => ({ connection }), (error: unknown) => ({ error }))
    }
    const result = await target.dialogConnection
    if (result === undefined) return undefined
    if ('error' in result) throw result.error
    return result.connection
  }

  private async dialogFeedback(target: TabTarget, dialog: Dialog, input: Extract<ComputerInput, { action: 'dialog' }>, signal: AbortSignal): Promise<void> {
    const window = target.dialogWindow = await this.resolveDialog(target, signal)
    this.feedback.select(input.target, window.windowId, window.bounds, window.captureBounds)
    if (this.preview !== undefined) {
      this.preview.dialogWindow = window
      // Capture before paced feedback holds the native queue; readers then use live metadata.
      await this.readPreview(signal, true)
    }
    const anchor = { x: window.anchor.frame.x + window.anchor.frame.w / 2, y: window.anchor.frame.y + window.anchor.frame.h / 2 }
    await this.feedback.move(anchor, window.windowId, window.bounds, signal, 0)
    const move = async (control: BrowserDialogWindow['accept']) => {
      const frame = control.frame
      const point = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 }
      if (this.preview !== undefined) {
        this.preview.action = 'move'
      }
      await this.feedback.move(point, window.windowId, window.bounds, signal)
    }
    if (input.accept && dialog.type() === 'prompt' && input.text !== undefined) {
      const field = window.field
      if (field === undefined) throw new ComputerError('DIALOG_FEEDBACK_UNAVAILABLE', 'The prompt input field is unavailable.', 'none', 'Observe the same dialog before continuing.')
      await move(field)
      await this.feedback.show('click', signal)
      if (this.preview !== undefined) this.preview.action = 'type'
      await this.feedback.show('type', signal, true)
      let text = ''
      const write = async (value: string, key?: string) => {
        await this.callNative('set_value', { session: this.session, pid: window.pid, window_id: window.windowId,
          element_token: field.element_token, value }, signal)
        if (key !== undefined) await this.feedback.show('type', signal, true, key)
        await this.readPreview(signal, true)
      }
      await write(text)
      await typeCharacters(input.text, this.config.typingDelayMs, async (character) => {
        text += character; await write(text, characterLabel(character))
      }, signal)
    }
    const button = input.accept || dialog.type() === 'alert' ? window.accept : window.cancel
    if (button === undefined) throw new ComputerError('DIALOG_FEEDBACK_UNAVAILABLE', 'The dialog cancel button is unavailable.', 'none', 'Observe the same dialog before continuing.')
    await move(button)
    if (this.preview !== undefined) {
      this.preview.action = 'click'
    }
    await this.feedback.show('click', signal)
    // The native window can disappear on acceptance; let its 450 ms pulse render first.
    await delay(Math.min(450, this.config.overlayIdleMs), undefined, { signal })
  }

  private async settleBrowserAction(target: TabTarget, input: Parameters<ComputerRuntime['browserAction']>[1], signal: AbortSignal): Promise<void> {
    if (input.action === 'dialog' || target.dialog !== undefined) return this.browserAction(target, input, signal)
    const pending: PendingInput = {
      dialog: Promise.withResolvers<undefined>(),
      done: Promise.resolve().then(() => this.browserAction(target, input, signal)).then(
        () => ({ kind: 'completed' as const }), (error: unknown) => ({ kind: 'failed' as const, error }),
      ),
    }
    target.pending = pending
    const outcome = await Promise.race([pending.done, pending.dialog.promise.then(() => ({ kind: 'dialog' as const }))])
    if (outcome.kind === 'dialog') return
    delete target.pending
    if (outcome.kind === 'failed') throw outcome.error
  }

  private async stopBrowserLoading(): Promise<void> {
    await Promise.all([...this.targets.values()].flatMap(target => target.kind !== 'tab' || target.page.isClosed() || target.dialog !== undefined ? [] : [(async () => {
      const session = await target.page.context().newCDPSession(target.page)
      try { await session.send('Page.stopLoading') } finally { await session.detach() }
    })()]))
  }

  private async windowAction(target: WindowTarget, input: TargetAction, signal: AbortSignal): Promise<NativeResult | void> {
    const args: Record<string, unknown> = { session: this.session, pid: target.pid, window_id: target.windowId }
    if ('locator' in input && input.locator !== undefined) throw new ComputerError('REF_REQUIRED', 'Native windows use element refs or screenshot coordinates.', 'none', 'Observe the window and use a returned element_token as ref.')
    if ('ref' in input && input.ref !== undefined) {
      if (('x' in input && input.x !== undefined) || ('y' in input && input.y !== undefined)) throw new ComputerError('AMBIGUOUS_ADDRESS', 'Choose either an element ref or coordinates.', 'none', 'Use exactly one addressing method.')
      if (!target.observation?.refs.has(input.ref)) throw new ComputerError('STALE_REF', 'The element ref is absent from the latest observation of this window.', 'none', 'Observe the window and select its current element ref.')
      args.element_token = input.ref
    } else if ('x' in input && input.x !== undefined) {
      this.requirePixels(target, input)
      args.x = input.x
      args.y = input.y
    }
    if (this.inputMode === 'foreground' && input.action !== 'menu' && input.action !== 'navigate' && input.action !== 'dialog') {
      const observation = target.observation
      const bounds = observation?.bounds
      if (observation === undefined || bounds === undefined) throw new ComputerError('WINDOW_REQUIRED', 'The observed window rectangle is unavailable.', 'none', 'Observe the exact target again.')
      let point: { x: number; y: number } | undefined
      if ('ref' in input && input.ref !== undefined) {
        const frame = observation.elements.get(input.ref)?.frame
        if (frame == null || frame.w <= 0 || frame.h <= 0) throw new ComputerError('ELEMENT_NOT_VISIBLE',
          'This element has no visible rectangle for system input.', 'none', 'Observe with screenshot: true and choose its visible control.')
        point = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 }
      } else if ('x' in input && input.x !== undefined && input.y !== undefined) {
        point = { x: bounds.x + input.x / (observation.scaleX ?? 1), y: bounds.y + input.y / (observation.scaleY ?? 1) }
      }
      let destination: { x: number; y: number } | undefined
      if (input.action === 'drag') {
        if (input.toLocator !== undefined) throw new ComputerError('REF_REQUIRED', 'Native drag destinations use screenshot coordinates.', 'none', 'Observe with screenshot: true and supply toX and toY.')
        const end = this.requirePixels(target, { x: input.toX, y: input.toY })
        destination = { x: bounds.x + end.x / (observation.scaleX ?? 1), y: bounds.y + end.y / (observation.scaleY ?? 1) }
      }
      return foregroundAction({ owner: input.target, pid: target.pid, windowId: target.windowId, bounds, focus: observation.focus,
        scaleX: observation.scaleX ?? 1, scaleY: observation.scaleY ?? 1,
        ...point === undefined ? {} : { point }, ...destination === undefined ? {} : { destination } }, input, this.config, this.feedback,
      (name, args, active) => this.callNative(name, { ...args, session: this.session }, active), signal)
    }
    switch (input.action) {
      case 'move':
        this.requireAddress(args, input.action)
        await this.nativeFeedback(target, input, signal)
        return
      case 'click': {
        this.requireAddress(args, input.action)
        await this.nativeFeedback(target, input, signal)
        const clicked = await this.callNative('click', { ...args, button: input.button, count: input.count, delivery_mode: 'background' }, signal)
        await this.feedback.show('click', signal)
        return clicked
      }
      case 'type':
        this.requireAddress(args, input.action)
        await this.nativeFeedback(target, input, signal)
        if (input.replace) {
          if (input.ref === undefined) throw new ComputerError('REF_REQUIRED', 'Replacing native text requires an element ref.', 'none', 'Observe the window and select an editable element ref.')
          return this.callNative('set_value', { ...args, value: input.text }, signal)
        } else return this.callNative('type_text', { ...args, text: input.text, delivery_mode: 'background' }, signal)
      case 'key':
        await this.nativeFeedback(target, input, signal)
        return this.callNative('hotkey', { ...args, keys: input.keys, delivery_mode: 'background' }, signal)
      case 'scroll': {
        this.requireAddress(args, input.action)
        await this.nativeFeedback(target, input, signal)
        const scrolled = await this.callNative('scroll', { ...args, direction: input.direction, amount: input.amount, delivery_mode: 'background' }, signal)
        await this.feedback.scroll(input.direction, signal)
        return scrolled
      }
      case 'drag':
        throw new ComputerError('BACKGROUND_UNAVAILABLE', 'macOS does not provide background dragging for this native window.', 'none',
          'Ask the user to perform the drag. The agent does not move the system pointer or activate the window.')
      case 'menu':
        await this.nativeFeedback(target, input, signal)
        return this.callNative('invoke_menu', { ...args, path: input.path }, signal)
      case 'navigate': case 'dialog': throw new ComputerError('TAB_REQUIRED', `${input.action} requires a browser tab target.`, 'none', 'Open a browser or select an existing tab from list.')
      /* v8 ignore next -- operations are parsed from the closed tool argument union. */
      default: return assertNever(input, 'native action')
    }
  }

  private async nativeFeedback(target: WindowTarget, input: ComputerInput, signal: AbortSignal): Promise<void> {
    if (!this.config.showOverlay || process.platform !== 'darwin') return
    const bounds = target.observation?.bounds
    if (bounds === undefined || bounds.width <= 0 || bounds.height <= 0) return
    const current = windowList.parse((await this.callNative('list_windows', { pid: target.pid, on_screen_only: false }, signal)).structuredContent)
      .windows.find(window => window.pid === target.pid && window.window_id === target.windowId)
    if (current?.bounds === undefined || (['x', 'y', 'width', 'height'] as const).some(key => current.bounds?.[key] !== bounds[key])) {
      throw new ComputerError('WINDOW_MOVED', 'The target window changed after observation.', 'none', 'Observe the same window before continuing.')
    }
    if ('target' in input) this.feedback.select(input.target, target.windowId, bounds, bounds,
      current.is_on_screen !== false && current.on_current_space !== false)
    let point: { x: number; y: number } | undefined
    if ('ref' in input && input.ref !== undefined) {
      const frame = target.observation?.elements.get(input.ref)?.frame
      if (frame != null && frame.w > 0 && frame.h > 0) point = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 }
    } else if ('x' in input && input.x !== undefined && 'y' in input && input.y !== undefined) {
      point = { x: bounds.x + input.x / (target.observation?.scaleX ?? 1), y: bounds.y + input.y / (target.observation?.scaleY ?? 1) }
    }
    if (point !== undefined) {
      if (point.x < bounds.x || point.y < bounds.y || point.x >= bounds.x + bounds.width || point.y >= bounds.y + bounds.height) {
        throw new ComputerError('POINT_OUTSIDE_WINDOW', 'The point is outside the observed window.', 'none', 'Observe the window and choose a visible element.')
      }
      await this.feedback.move(point, target.windowId, bounds, signal)
    }
    if (input.action === 'type') await this.feedback.show('type', signal)
    if (input.action === 'key') await this.feedback.show(input.keys, signal)
  }

  private target(id: string): Target {
    const target = this.targets.get(id as TargetId)
    if (target === undefined) throw new ComputerError('TARGET_NOT_FOUND', `Target ${id} does not belong to this live Session.`, 'none', 'List targets again; browser and window handles are not restored from the Session log.')
    return target
  }

  private tab(target: Target): TabTarget {
    if (target.kind !== 'tab') throw new ComputerError('TAB_REQUIRED', 'This operation requires a browser tab.', 'none', 'Choose a tab target from list or open_browser.')
    return target
  }

  private requireObservation(target: Target, input: TargetAction): void {
    if (target.kind === 'tab' && target.dialog !== undefined) return
    if (target.observation === undefined || Date.now() - target.observation.at > this.config.observationMaxAgeMs) {
      const coordinates = 'x' in input && input.x !== undefined || 'y' in input && input.y !== undefined
      const observe = { action: 'observe', target: input.target, ...coordinates ? { screenshot: true } : {} }
      throw new ComputerError('OBSERVATION_REQUIRED', 'The target needs a fresh observation before input.', 'none',
        `Run ${JSON.stringify(observe)}, then use ${coordinates ? 'coordinates from that new screenshot' : 'the fresh state and any newly returned refs'} before acting.`)
    }
  }

  private async renewNativeRef(id: TargetId, target: Target, input: TargetAction, signal: AbortSignal): Promise<TargetAction> {
    if (target.kind !== 'window' || target.observation === undefined) return input
    const previous = target.observation
    if (Date.now() - previous.at <= this.config.observationMaxAgeMs
      || !('ref' in input) || input.ref === undefined) return input
    const element = previous.elements.get(input.ref)
    const identity = element === undefined ? undefined : nativeElementIdentity(element)
    if (identity === undefined || !previous.elementsComplete) return input
    await this.observe(id, target, false, signal)
    const matches = [...target.observation.elements].filter(([, item]) => nativeElementIdentity(item) === identity)
    const match = target.observation.elementsComplete && matches.length === 1 ? matches[0] : undefined
    if (match === undefined) throw new ComputerError('OBSERVATION_CHANGED',
      'The native control changed while the observation expired. No input was sent.', 'none',
      'Observe this window and choose its current control before continuing.')
    return { ...input, ref: match[0] }
  }

  private nativeResult(id: TargetId, state: NativeWindowState & { elements: NativeElement[] }, images: Content,
    actionResult?: NativeActionResult, blocked = false): NativeResult {
    const count = state.elements.length
    const render = () => this.result({ status: blocked ? 'failed' : 'observed', target: id, kind: 'window', state,
      ...actionResult === undefined ? {} : { actionResult,
        ...actionResult.effect === 'confirmed' ? {} : { nextAction:
          'Input delivery does not confirm the intended result. Verify the target change in this observation. If it did not occur, stop repeating input and select Foreground system input in Computer Control settings before continuing.' } },
      ...!blocked ? {} : { code: 'BACKGROUND_EFFECT_UNCONFIRMED', effect: 'possible',
        message: 'The clicked control remains unchanged. Further background input to this window is blocked.',
        nextAction: 'Select Foreground system input in Computer Control settings, save, and continue this conversation. Observation remains available.' },
    }, images)
    let result = render()
    while (JSON.stringify(result.structuredContent).length > this.config.maxSnapshotChars && state.elements.length > 0) {
      state.elements.pop()
      state.elements_complete = false
      state.returned_element_count = state.elements.length
      state.omitted_elements = count - state.elements.length
      result = render()
    }
    if (JSON.stringify(result.structuredContent).length > this.config.maxSnapshotChars) throw new ComputerError('SNAPSHOT_LIMIT_TOO_SMALL',
      'The native observation metadata exceeds maxSnapshotChars.', 'none', 'Increase maxSnapshotChars and observe this window again.')
    return { ...result, ...blocked ? { isError: true } : {} }
  }

  private requirePixels(target: Target, input: Pick<Address, 'x' | 'y'>): { x: number; y: number } {
    if (input.x === undefined || input.y === undefined || !target.observation?.screenshot) throw new ComputerError('SCREENSHOT_REQUIRED', 'Coordinate input requires x, y, and a fresh screenshot of this target.', 'none', 'Observe with screenshot=true, then use coordinates from that image.')
    if (Date.now() - target.observation.at > this.config.coordinateMaxAgeMs) throw new ComputerError('SCREENSHOT_EXPIRED',
      'The screenshot is too old for coordinate input.', 'none', 'Observe this target with screenshot: true before using coordinates.')
    const pixels = target.observation.pixels
    if (pixels !== undefined && (input.x >= pixels.width || input.y >= pixels.height)) throw new ComputerError('POINT_OUTSIDE_SCREENSHOT',
      'The point is outside the observed screenshot.', 'none', 'Use a point inside the current target screenshot.')
    return { x: input.x, y: input.y }
  }

  private requireAddress(args: Record<string, unknown>, action: 'move' | 'click' | 'type' | 'scroll'): void {
    if (args.element_token === undefined && args.x === undefined) throw new ComputerError('REF_REQUIRED', 'Native input needs an element ref or screenshot coordinates.', 'none',
      action === 'click' || action === 'type'
        ? 'Include target plus an element_token as ref from the latest observation on every call. Native pixel click and typing require explicit foreground input because that route can activate the application.'
        : 'Observe the window and select an element ref or a point in its screenshot.')
  }

  private browserLocator(page: Page, input: Address): Locator | undefined {
    if (input.ref !== undefined) throw new ComputerError('LOCATOR_REQUIRED', 'Browser elements use locators, not native refs.', 'none', 'Select a browser element by its observed role and accessible name.')
    if (input.locator === undefined) return undefined
    if (input.x !== undefined || input.y !== undefined) throw new ComputerError('AMBIGUOUS_ADDRESS', 'Choose either a locator or coordinates.', 'none', 'Use exactly one addressing method.')
    const loc = input.locator
    switch (loc.by) {
      case 'role': return page.getByRole(loc.role, { name: loc.name, exact: loc.exact })
      case 'label': return page.getByLabel(loc.text, { exact: loc.exact })
      case 'text': return page.getByText(loc.text, { exact: loc.exact })
      case 'css': return page.locator(loc.selector)
      /* v8 ignore next -- locators are parsed from the closed tool argument union. */
      default: return assertNever(loc, 'browser locator')
    }
  }

  private validateUrl(value: string): void {
    let url: URL
    try { url = new URL(value) } catch { throw new ComputerError('INVALID_URL', 'A browser URL must be absolute.', 'none', 'Use an absolute http or https URL, or about:blank.') }
    if (!['http:', 'https:'].includes(url.protocol) && url.href !== 'about:blank') throw new ComputerError('INVALID_URL', 'This browser accepts http, https, and about:blank URLs.', 'none', 'Use an allowed URL.')
  }

  private checkCapacity(): void {
    if (this.targets.size >= this.config.maxTargets) throw new ComputerError('TARGET_LIMIT', 'This Session reached its configured target limit.', 'none', 'Close an owned tab or reset computer resources.')
  }

  private result(data: Record<string, unknown>, images: Content = []): NativeResult {
    const tabs = data.kind === 'tab' ? [...this.targets].flatMap(([id, target]) => target.kind === 'tab'
      ? [{ target: id, url: target.page.url() }] : []) : undefined
    const result = { ...data, ...tabs === undefined ? {} : { tabs }, capabilities: { browser: true, native: this.nativeEnabled(),
      nativeForeground: this.native !== undefined, nativeBackground: this.native !== undefined && this.config.nativeBackground },
    inputMode: this.inputMode, ...this.closedPopups === 0 ? {} : { closedPopups: this.closedPopups } }
    return { content: [{ type: 'text', text: JSON.stringify(result) }, ...images], structuredContent: result }
  }

  private async callNative(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<NativeResult> {
    this.requireNative()
    this.nativeUsed = true
    if (name === 'get_window_state') return this.readNativeWindow(args, signal, this.config.operationTimeoutMs)
    return this.requireNative().call(name, args, signal, name === 'launch_app' ? this.config.navigationTimeoutMs : this.config.operationTimeoutMs)
  }

  private nativeEnabled(): boolean {
    return this.native !== undefined && (this.inputMode === 'foreground' || this.config.nativeBackground)
  }

  private requireNativeMode(): void {
    this.requireNative()
    if (!this.nativeEnabled()) throw new ComputerError('NATIVE_FOREGROUND_REQUIRED',
      'Browser background mode does not support desktop application operations.', 'none',
      'Stop desktop attempts. Explain that this mode supports browser tabs only. Desktop applications require the user to select Foreground system input and save before continuing.')
  }

  private readNativeWindow(args: Record<string, unknown>, signal: AbortSignal, timeoutMs: number): Promise<NativeResult> {
    const native = this.requireNative()
    return native.exclusive('get_window_state', signal, async () => {
      await this.startNativeSession(signal, timeoutMs)
      return native.call('get_window_state', { ...args, session: this.session }, signal, timeoutMs)
    })
  }

  private async startNativeSession(signal: AbortSignal, timeoutMs: number): Promise<void> {
    const native = this.requireNative()
    this.nativeUsed = true
    try { await native.call('start_session', { session: this.session }, signal, timeoutMs) } catch (error) {
      if (!(error instanceof ComputerError) || error.code !== 'session_ended') throw error
      this.session = `dsh-${randomUUID()}`
      for (const target of this.targets.values()) {
        if (target.kind === 'window') delete target.observation
        else delete target.dialogWindow
      }
      await native.call('start_session', { session: this.session }, signal, timeoutMs)
    }
  }

  private message(error: unknown): string { return error instanceof Error ? error.message : String(error) }

  private requireNative(): NativeCalls {
    if (this.native === undefined) throw new ComputerError('UNSUPPORTED_PLATFORM', 'Native desktop operations require macOS.',
      'none', 'Use open_browser and operate this Session’s browser tabs.')
    return this.native
  }

  private browserDisconnected(browser: Browser): void {
    if (this.browser !== browser) return
    this.browser = undefined
    this.context = undefined
    this.dialogCDP = undefined
  }
}
