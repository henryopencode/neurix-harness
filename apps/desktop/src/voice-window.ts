/** Owns the native voice controls while the primary application window is minimized or hidden. */
import { app, BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from 'electron'
import type { DesktopVoiceEvent, DesktopVoiceState } from '@deepseek-ai/dsh-voice-chat/types'
import { parseDesktopVoiceCommand, parseDesktopVoiceState, VOICE_WINDOW_IPC, type VoiceWindowSnapshot } from './voice-window-protocol.ts'

/** Dependencies retained until the shell withdraws the native controls. */
export interface DesktopVoiceWindowOptions {
  readonly preload: string
  readonly mainWindow: () => BrowserWindow | undefined
  readonly assertApplication: (event: IpcMainInvokeEvent) => BrowserWindow
  readonly report: (error: unknown) => void
}

/** One shell-owned view of the renderer's existing audio lifetime. */
export class DesktopVoiceWindow {
  private state: DesktopVoiceState | null = null
  private revision = 0
  private generation = 0
  private window: BrowserWindow | undefined
  private loading: Promise<void> | undefined
  private owner: BrowserWindow | undefined
  private baselineThrottling: boolean | undefined
  private detachOwner: (() => void) | undefined
  private disposed = false
  private unavailable = false
  private readonly quitting = (): void => { this.reset(true) }
  private readonly exited = (): void => { this.dispose() }

  constructor(private readonly options: DesktopVoiceWindowOptions) {
    ipcMain.handle(VOICE_WINDOW_IPC.publish, (event, input: unknown) => {
      const owner = options.assertApplication(event)
      const state = parseDesktopVoiceState(input)
      if (this.owner !== owner) this.attach(owner)
      this.state = state; this.revision++
      if (state === null) { this.reset(false); return }
      if (this.baselineThrottling === undefined) {
        this.baselineThrottling = owner.webContents.getBackgroundThrottling()
        owner.webContents.setBackgroundThrottling(false)
      }
      this.window?.webContents.send(VOICE_WINDOW_IPC.changed, this.snapshot())
      if (this.background(owner)) this.requestShow(owner)
    })
    ipcMain.handle(VOICE_WINDOW_IPC.minimize, async (event) => {
      const owner = options.assertApplication(event)
      if (this.state === null) throw new Error('No voice conversation is active')
      owner.minimize()
      await this.show(owner)
    })
    ipcMain.handle(VOICE_WINDOW_IPC.state, (event) => { this.assertControls(event); return this.snapshot() })
    ipcMain.handle(VOICE_WINDOW_IPC.command, (event, input: unknown) => {
      this.assertControls(event)
      const command = parseDesktopVoiceCommand(input)
      if (command === 'restore') this.restore()
      else this.send(command)
    })
    app.on('before-quit', this.quitting)
    app.on('will-quit', this.exited)
  }

  /**
   * Observe only the primary application window, never auxiliary or onboarding windows.
   * @param owner - current primary application window.
   */
  attach(owner: BrowserWindow): void {
    if (this.owner === owner) return
    this.reset(false); this.detachOwner?.(); this.owner = owner
    const hidden = (): void => {
      if (this.state === null) return
      if (process.platform === 'darwin' && app.isHidden()) this.reset(true)
      else this.requestShow(owner)
    }
    const shown = (): void => { this.window?.hide() }
    const reset = (): void => { this.reset(false) }
    const navigation = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>): void => {
      if (event.isMainFrame && !event.isSameDocument) reset()
    }
    owner.on('minimize', hidden); owner.on('hide', hidden)
    owner.on('restore', shown); owner.on('show', shown)
    owner.webContents.on('did-start-navigation', navigation)
    owner.on('closed', reset)
    this.detachOwner = () => {
      owner.off('minimize', hidden); owner.off('hide', hidden)
      owner.off('restore', shown); owner.off('show', shown)
      owner.webContents.off('did-start-navigation', navigation); owner.off('closed', reset)
    }
  }

  private snapshot(): VoiceWindowSnapshot { return { revision: this.revision, state: this.state } }
  private background(owner: BrowserWindow): boolean {
    return (process.platform !== 'darwin' || !app.isHidden()) && (owner.isMinimized() || !owner.isVisible())
  }

  private assertControls(event: IpcMainInvokeEvent): void {
    const owner = this.window
    if (!owner || owner.isDestroyed() || event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame
      || !event.senderFrame.url.startsWith('dsh-app://voice/')) throw new Error('Rejected desktop voice window command')
  }

  private send(command: DesktopVoiceEvent): void {
    const owner = this.options.mainWindow()
    if (owner && !owner.isDestroyed()) owner.webContents.send(VOICE_WINDOW_IPC.action, command)
  }

  private restore(): void {
    const owner = this.options.mainWindow()
    if (!owner || owner.isDestroyed()) return
    if (owner.isMinimized()) owner.restore()
    owner.show(); owner.focus(); this.window?.hide()
  }

  private requestShow(owner: BrowserWindow): void {
    const generation = this.generation
    void this.show(owner).catch((error: unknown) => { this.recover(error, owner, generation) })
  }

  private recover(error: unknown, owner: BrowserWindow, generation: number): void {
    if (this.disposed || this.state === null || this.unavailable || generation !== this.generation
      || this.options.mainWindow() !== owner) return
    this.unavailable = true
    this.options.report(error); this.restore(); this.send('unavailable')
  }

  private async show(owner: BrowserWindow): Promise<void> {
    if (this.unavailable) { this.restore(); throw new Error('Desktop voice controls are unavailable') }
    if (this.loading) return this.loading
    if (this.disposed || this.state === null || owner.isDestroyed() || !this.background(owner)) return Promise.resolve()
    if (this.window && !this.window.isDestroyed()) { this.window.showInactive(); return Promise.resolve() }
    const generation = this.generation
    const area = screen.getDisplayMatching(owner.getBounds()).workArea
    const window = new BrowserWindow({ width: 280, height: 280, x: area.x + area.width - 304, y: area.y + 64,
      show: false, frame: false, transparent: true, backgroundColor: '#00000000', alwaysOnTop: true, skipTaskbar: true, resizable: false,
      minimizable: false, maximizable: false, fullscreenable: false,
      ...process.platform === 'darwin' ? { type: 'panel' } : {},
      webPreferences: { preload: this.options.preload, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
    })
    this.window = window
    if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    window.on('hide', () => { if (this.state !== null && process.platform === 'darwin' && app.isHidden()) this.reset(true) })
    window.webContents.on('render-process-gone', (_event, details) => { this.recover(new Error(`Voice window renderer exited: ${details.reason}`), owner, generation) })
    window.webContents.on('preload-error', (_event, _path, error) => { this.recover(error, owner, generation) })
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error') this.recover(new Error(details.message), owner, generation)
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => { event.preventDefault() })
    window.on('closed', () => {
      if (this.window !== window) return
      this.window = undefined
      if (this.state !== null && !this.disposed) { this.send('end'); this.restore() }
    })
    const loading = window.loadURL('dsh-app://voice/voice-window.html').then(() => {
      if (generation !== this.generation || window !== this.window || window.isDestroyed()) return
      window.webContents.send(VOICE_WINDOW_IPC.changed, this.snapshot())
      if (this.state !== null && this.background(owner)) window.showInactive()
    }).finally(() => { if (generation === this.generation) this.loading = undefined })
    this.loading = loading
    return loading
  }

  private reset(end: boolean): void {
    if (end && this.state !== null) this.send('end')
    this.state = null; this.unavailable = false; this.revision++; this.generation++
    const window = this.window
    this.window = undefined; this.loading = undefined
    if (window && !window.isDestroyed()) window.destroy()
    if (this.baselineThrottling !== undefined && this.owner && !this.owner.isDestroyed()) {
      this.owner.webContents.setBackgroundThrottling(this.baselineThrottling)
    }
    this.baselineThrottling = undefined
  }

  /** Withdraw listeners, native windows, and IPC after application shutdown. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true; this.reset(false); this.detachOwner?.()
    app.off('before-quit', this.quitting); app.off('will-quit', this.exited)
    for (const key of [
      VOICE_WINDOW_IPC.publish, VOICE_WINDOW_IPC.minimize, VOICE_WINDOW_IPC.state, VOICE_WINDOW_IPC.command,
    ]) ipcMain.removeHandler(key)
  }
}
