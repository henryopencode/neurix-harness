/** Controllable external browser for deterministic deadline and teardown races. @module */

import { EventEmitter } from 'node:events'
import { screenshotBase64 } from './native.ts'

/** External-browser controls isolated to one Vitest module worker. */
export const browserFixture = {
  browsers: [] as FixtureBrowser[],
  calls: [] as Array<{ name: string; args: unknown[] }>,
  fail: undefined as string | undefined,
  launchError: undefined as Error | undefined,
  closeError: undefined as Error | undefined,
  dialogOnClick: false,
  dialogType: 'confirm',
  currentDialog: undefined as { accept(text?: string): Promise<void>; dismiss(): Promise<void> } | undefined,
  blocked: undefined as PromiseWithResolvers<undefined> | undefined,
  entered: undefined as PromiseWithResolvers<undefined> | undefined,
  blockedOperation: 'locator.click',
  focusedEditable: false,
  locatorEditable: true,
  locatorObserved: true,
  locatorCount: 1,
  screenshotData: screenshotBase64,
  locatorBounds: {} as Record<string, { x: number; y: number; width: number; height: number } | null>,
}

/** @param name - external operation. @param args - operation arguments. @returns after optional controlled blocking. */
function operation(name: string, ...args: unknown[]): Promise<void> {
  browserFixture.calls.push({ name, args })
  if (browserFixture.fail === name) return Promise.reject(new Error(`${name} failed`))
  if (browserFixture.blocked !== undefined && name === browserFixture.blockedOperation) {
    browserFixture.entered?.resolve(undefined)
    return browserFixture.blocked.promise
  }
  return Promise.resolve()
}

class FixtureLocator {
  constructor(private readonly page: FixturePage, private readonly address = '') {}
  click(args: unknown): Promise<void> {
    if (browserFixture.dialogOnClick) {
      browserFixture.calls.push({ name: 'dialog.click', args: [args] })
      const type = this.address === '#dialog-prompt' ? 'prompt' : browserFixture.dialogType
      const settled = Promise.withResolvers<undefined>()
      this.page.once('close', () => { settled.reject(new Error('Dialog page closed')) })
      const dialog = {
        type: () => type, message: () => 'Confirm operation?', defaultValue: () => '',
        accept(text?: string) {
          browserFixture.currentDialog = undefined
          browserFixture.calls.push({ name: 'dialog.accept', args: [text] })
          if (browserFixture.fail === 'dialog_input') settled.reject(new Error('Dialog input failed'))
          else settled.resolve(undefined)
          return Promise.resolve()
        },
        dismiss() { browserFixture.currentDialog = undefined; browserFixture.calls.push({ name: 'dialog.dismiss', args: [] }); settled.resolve(undefined); return Promise.resolve() },
      }
      browserFixture.currentDialog = dialog
      this.page.emit('dialog', dialog)
      return settled.promise
    }
    return operation('locator.click', args)
  }
  fill(text: string): Promise<void> { return operation('locator.fill', text) }
  focus(): Promise<void> { return operation('locator.focus').then(() => { browserFixture.focusedEditable = true }) }
  scrollIntoViewIfNeeded(): Promise<void> { return operation('scrollIntoView') }
  pressSequentially(text: string): Promise<void> { return operation('locator.type', text) }
  hover(): Promise<void> { return operation('locator.hover') }
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return operation('boundingBox').then(() => {
      const bounds = browserFixture.locatorBounds[this.address]
      return bounds === undefined ? { x: 28, y: 60, width: 500, height: 36 } : bounds
    })
  }
  isEditable(): Promise<boolean> { return operation('isEditable').then(() => browserFixture.locatorEditable) }
  count(): Promise<number> { return Promise.resolve(browserFixture.locatorCount) }
  elementHandle(): Promise<this> { return Promise.resolve(this) }
  dispose(): Promise<void> { return operation('element.dispose') }
  evaluate(_expression?: unknown, snapshot?: unknown): Promise<boolean> {
    return operation('locator.evaluate').then(() => snapshot === undefined ? browserFixture.focusedEditable : browserFixture.locatorObserved)
  }
  ariaSnapshot(): Promise<string> { return operation('snapshot').then(() => '- textbox "Task name"\n- button "Save"') }
}

/** One controllable external page, independent of the production target map. */
export class FixturePage extends EventEmitter {
  constructor(private readonly owner: FixtureContext) { super() }
  location = 'about:blank'
  readonly keyboard = { press: (key: string) => operation('keyboard.press', key),
    insertText: (text: string) => operation('keyboard.insertText', text) }
  readonly mouse = {
    click: (...args: unknown[]) => operation('mouse.click', ...args).then(() => { browserFixture.focusedEditable = true }),
    move: (...args: unknown[]) => operation('mouse.move', ...args),
    down: () => operation('mouse.down'), up: () => operation('mouse.up'),
    wheel: (...args: unknown[]) => operation('mouse.wheel', ...args),
  }
  goto(url: string): Promise<void> { this.location = url; return operation('goto', url) }
  mainFrame(): this { return this }
  url(): string { return this.location }
  context(): FixtureContext { return this.owner }
  isClosed(): boolean { return false }
  bringToFront(): Promise<void> { return operation('bringToFront') }
  waitForFunction(): Promise<void> { return operation('waitForFunction') }
  evaluateHandle(): Promise<{ dispose(): Promise<void> }> {
    return Promise.resolve({ dispose: () => operation('observation.dispose') })
  }
  evaluate(expression: string): Promise<unknown> {
    if (expression.includes('geometryElements')) return Promise.resolve({
      viewport: { width: 1200, height: 919, scrollX: 0, scrollY: 0 },
      elements: [{ tag: 'button', label: 'Drag source', inViewport: true, locator: { by: 'css', selector: '#drag-source' },
        bounds: { x: 20, y: 30, width: 40, height: 40 } }],
    })
    if (expression.includes('querySelectorAll')) return Promise.resolve([{ tag: 'textarea', placeholder: 'Task name', label: '',
      value: '', valueTruncated: false,
      focused: browserFixture.focusedEditable, locator: { by: 'css', selector: '#task-name' } }])
    return Promise.resolve({ width: 1200, height: 919, outerWidth: 1200, outerHeight: 980, visible: true })
  }
  title(): Promise<string> { return Promise.resolve('Browser fixture') }
  close(): Promise<void> { this.emit('close'); return operation('page.close') }
  locator(selector: string): FixtureLocator { browserFixture.calls.push({ name: 'locator', args: [selector] }); return new FixtureLocator(this, selector) }
  getByRole(...args: unknown[]): FixtureLocator { browserFixture.calls.push({ name: 'role', args }); return new FixtureLocator(this) }
  getByText(...args: unknown[]): FixtureLocator { browserFixture.calls.push({ name: 'text', args }); return new FixtureLocator(this) }
  getByLabel(...args: unknown[]): FixtureLocator { browserFixture.calls.push({ name: 'label', args }); return new FixtureLocator(this) }
  screenshot(): Promise<Buffer> { return operation('screenshot').then(() => Buffer.from(screenshotBase64, 'base64')) }
}

/** Browser-context fixture that reports page creation before resolving newPage. */
export class FixtureContext extends EventEmitter {
  constructor(private readonly owner: FixtureBrowser) { super() }
  readonly pages: FixturePage[] = []
  browser(): FixtureBrowser { return this.owner }
  newPage(): Promise<FixturePage> {
    const page = new FixturePage(this)
    this.pages.push(page)
    this.emit('page', page)
    return operation('newPage').then(() => page)
  }
  setDefaultTimeout(timeout: number): void { browserFixture.calls.push({ name: 'timeout', args: [timeout] }) }
  setDefaultNavigationTimeout(timeout: number): void { browserFixture.calls.push({ name: 'navigationTimeout', args: [timeout] }) }
  newCDPSession() {
    const channel = new EventEmitter()
    const send = async (name: string, args?: Record<string, unknown>): Promise<unknown> => {
      if (name === 'Target.attachToTarget') return { sessionId: 'screenshot-reader' }
      if (name === 'Target.detachFromTarget') {
        browserFixture.blocked?.reject(new Error('Screenshot reader detached'))
        await operation(name, args)
        return {}
      }
      if (name === 'Target.sendMessageToTarget') {
        const request = JSON.parse(String(args?.message)) as { id: number; method: string; params?: Record<string, unknown> }
        void send(request.method, request.params).then((result) => {
          channel.emit('Target.receivedMessageFromTarget', { sessionId: 'screenshot-reader', message: JSON.stringify({ id: request.id, result }) })
        }, (error: unknown) => {
          channel.emit('Target.receivedMessageFromTarget', { sessionId: 'screenshot-reader',
            message: JSON.stringify({ id: request.id, error: { message: String(error) } }) })
        })
        return {}
      }
      if (name === 'SystemInfo.getProcessInfo') return { processInfo: [{ type: 'browser', id: 9 }] }
      if (name === 'Target.getTargetInfo') return { targetInfo: { targetId: 'owned-tab' } }
      if (name === 'Browser.getWindowForTarget') return { windowId: 7, bounds: { left: 100, top: 100, width: 560, height: 320 } }
      if (name === 'Runtime.evaluate') {
        await operation(name, args)
        return { result: { value: { x: 0, y: 0, width: 1200, height: 919, dpr: 2 } } }
      }
      if (name === 'Page.captureScreenshot') { await operation('screenshot', args); return { data: browserFixture.screenshotData } }
      await operation(name, ...args === undefined ? [] : [args])
      if (name === 'Page.stopLoading') browserFixture.blocked?.reject(new Error('Navigation stopped'))
    }
    return Promise.resolve(Object.assign(channel, { send, detach: () => operation('session.detach') }))
  }
}

/** Browser ownership fixture with observable close and independent disconnection. */
export class FixtureBrowser extends EventEmitter {
  readonly context = new FixtureContext(this)
  newBrowserCDPSession(): ReturnType<FixtureContext['newCDPSession']> { return this.context.newCDPSession() }
  newContext(options: unknown): Promise<FixtureContext> { return operation('newContext', options).then(() => this.context) }
  close(): Promise<void> {
    if (browserFixture.closeError !== undefined) return Promise.reject(browserFixture.closeError)
    browserFixture.blocked?.reject(new Error('Browser closed'))
    for (const page of this.context.pages) page.emit('close')
    this.emit('disconnected')
    return operation('browser.close')
  }
}

/** @param options - browser launch choices. @returns a test-owned external browser. */
export function launch(options: unknown): Promise<FixtureBrowser> {
  if (browserFixture.launchError !== undefined) return Promise.reject(browserFixture.launchError)
  const browser = new FixtureBrowser()
  browserFixture.browsers.push(browser)
  return operation('launch', options).then(() => browser)
}

/** Restore external controls after all test-owned work settles. */
export function resetBrowser(): void {
  browserFixture.browsers = []
  browserFixture.calls = []
  browserFixture.fail = undefined
  browserFixture.launchError = undefined
  browserFixture.closeError = undefined
  browserFixture.dialogOnClick = false
  browserFixture.dialogType = 'confirm'
  browserFixture.blocked = undefined
  browserFixture.entered = undefined
  browserFixture.blockedOperation = 'locator.click'
  browserFixture.focusedEditable = false
  browserFixture.locatorEditable = true
  browserFixture.locatorObserved = true
  browserFixture.locatorCount = 1
  browserFixture.currentDialog = undefined
  browserFixture.screenshotData = screenshotBase64
  browserFixture.locatorBounds = {}
}
