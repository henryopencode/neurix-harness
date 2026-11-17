/** Native controls project one existing audio owner and reject unrelated frames. */
import type { BrowserWindowConstructorOptions, IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron'
import { app, BrowserWindow } from 'electron'
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import type { DesktopVoiceState } from '@deepseek-ai/dsh-voice-chat/types'
import { DesktopVoiceWindow } from '../src/voice-window.ts'
import { parseDesktopVoiceState, VOICE_WINDOW_IPC } from '../src/voice-window-protocol.ts'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>(),
  windows: [] as BrowserWindow[], loading: undefined as Promise<void> | undefined,
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    app: Object.assign(new EventEmitter(), { isHidden: () => false }),
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) },
    ipcMain: { handle: (name: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
      electron.handlers.set(name, listener)
    },
    removeHandler: (name: string) => { electron.handlers.delete(name) } },
    BrowserWindow: vi.fn(function (options: BrowserWindowConstructorOptions = {}) {
      let visible = options.show !== false, minimized = false, destroyed = false, throttling = true
      const frame: Pick<WebFrameMain, 'url'> = { url: options.webPreferences?.preload?.includes('voice') ? 'dsh-app://voice/' : 'dsh-app://app/' }
      const contents: Pick<WebContents, 'send' | 'mainFrame' | 'setWindowOpenHandler' | 'getBackgroundThrottling' | 'setBackgroundThrottling'> & InstanceType<typeof EventEmitter> =
        Object.assign(new EventEmitter(), { mainFrame: frame as WebFrameMain, send: vi.fn(), setWindowOpenHandler: vi.fn(),
          getBackgroundThrottling: () => throttling, setBackgroundThrottling: vi.fn((value: boolean) => { throttling = value }) })
      const window: Pick<BrowserWindow, 'webContents' | 'getBounds' | 'isVisible' | 'isMinimized' | 'isDestroyed'
        | 'setVisibleOnAllWorkspaces' | 'show' | 'showInactive' | 'hide' | 'minimize' | 'restore' | 'focus' | 'destroy' | 'loadURL'> & InstanceType<typeof EventEmitter> = Object.assign(new EventEmitter(), {
          webContents: contents as WebContents, getBounds: () => ({ x: 0, y: 0, width: 1280, height: 820 }),
          isVisible: () => visible, isMinimized: () => minimized, isDestroyed: () => destroyed,
          show: vi.fn(() => { visible = true; window.emit('show') }), showInactive: vi.fn(() => { visible = true }),
          setVisibleOnAllWorkspaces: vi.fn(),
          hide: vi.fn(() => { visible = false; window.emit('hide') }), focus: vi.fn(),
          minimize: vi.fn(() => { minimized = true; visible = false; window.emit('minimize') }),
          restore: vi.fn(() => { minimized = false; visible = true; window.emit('restore') }),
          destroy: vi.fn(() => { destroyed = true; visible = false; window.emit('closed') }),
          loadURL: vi.fn(async (_url: string) => { await electron.loading }),
        })
      electron.windows.push(window as BrowserWindow)
      return window
    }),
  }
})

const state: DesktopVoiceState = { phase: 'listening', microphoneMuted: false, speakerMuted: false,
  labels: { status: 'Listening', muteMicrophone: 'Mute microphone', unmuteMicrophone: 'Unmute microphone',
    muteSpeaker: 'Mute speaker', unmuteSpeaker: 'Unmute speaker', end: 'End conversation', restore: 'Restore window' } }

beforeEach(() => { electron.handlers.clear(); electron.windows = []; electron.loading = undefined })

function mockMethod(target: object, key: string) {
  const method: unknown = Reflect.get(target, key)
  if (!vi.isMockFunction(method)) throw new Error(`Expected a controlled window method: ${key}`)
  return method
}

function fixture() {
  const owner = new BrowserWindow(), report = vi.fn()
  const controls = new DesktopVoiceWindow({ preload: '/owned/preload-voice-window.cjs', mainWindow: () => owner,
    assertApplication: (event) => {
      if (event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame) throw new Error('Foreign application frame')
      return owner
    }, report })
  onTestFinished(() => { controls.dispose(); for (const window of electron.windows) window.destroy() })
  const invoke = async (channel: string, input?: unknown, sender = owner): Promise<unknown> => {
    const event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'> = { sender: sender.webContents, senderFrame: sender.webContents.mainFrame }
    return await electron.handlers.get(channel)?.(event as IpcMainInvokeEvent, input)
  }
  return { owner, controls, invoke, report }
}

it('shows compact controls only while hidden and restores the same application and audio owner', async () => {
  const b = fixture()
  await b.invoke(VOICE_WINDOW_IPC.publish, state)
  expect(electron.windows).toHaveLength(1)
  expect(b.owner.webContents.getBackgroundThrottling()).toBe(false)
  await b.invoke(VOICE_WINDOW_IPC.minimize)
  const compact = electron.windows[1]!
  expect(compact.isVisible()).toBe(true)
  expect(mockMethod(compact, 'loadURL')).toHaveBeenCalledWith('dsh-app://voice/voice-window.html')
  await b.invoke(VOICE_WINDOW_IPC.command, 'microphone', compact)
  expect(mockMethod(b.owner.webContents, 'send')).toHaveBeenCalledWith(VOICE_WINDOW_IPC.action, 'microphone')
  await b.invoke(VOICE_WINDOW_IPC.command, 'restore', compact)
  expect(b.owner.isMinimized()).toBe(false)
  expect(b.owner.isVisible()).toBe(true)
  expect(compact.isVisible()).toBe(false)
  await b.invoke(VOICE_WINDOW_IPC.publish, null)
  expect(compact.isDestroyed()).toBe(true)
  expect(b.owner.webContents.getBackgroundThrottling()).toBe(true)
})

it('rejects foreign frames and malformed state before exposing desktop controls', async () => {
  const b = fixture(), other = new BrowserWindow()
  await expect(b.invoke(VOICE_WINDOW_IPC.publish, state, other)).rejects.toThrow('Foreign application frame')
  await expect(b.invoke(VOICE_WINDOW_IPC.publish, { ...state, microphoneMuted: 'false' })).rejects.toThrow('Invalid desktop voice state')
  await b.invoke(VOICE_WINDOW_IPC.publish, state)
  await b.invoke(VOICE_WINDOW_IPC.minimize)
  await expect(b.invoke(VOICE_WINDOW_IPC.command, 'end', other)).rejects.toThrow('Rejected desktop voice window command')
  await expect(b.invoke(VOICE_WINDOW_IPC.command, 'shell', electron.windows[2])).rejects.toThrow('Invalid desktop voice command')
})

it('does not show a late-loading control window after audio has ended', async () => {
  const b = fixture(), loaded = Promise.withResolvers<undefined>()
  electron.loading = loaded.promise
  await b.invoke(VOICE_WINDOW_IPC.publish, state)
  const minimized = b.invoke(VOICE_WINDOW_IPC.minimize)
  const compact = electron.windows[1]!
  await b.invoke(VOICE_WINDOW_IPC.publish, null)
  loaded.resolve(undefined); await minimized
  expect(compact.isDestroyed()).toBe(true)
  expect(mockMethod(compact, 'showInactive')).not.toHaveBeenCalled()
})

it('restores the application and requests audio shutdown when compact rendering fails', async () => {
  const b = fixture(), loaded = Promise.withResolvers<undefined>()
  electron.loading = loaded.promise
  await b.invoke(VOICE_WINDOW_IPC.publish, state)
  const minimized = b.invoke(VOICE_WINDOW_IPC.minimize)
  const rejected = expect(minimized).rejects.toThrow('render failed')
  loaded.reject(new Error('render failed')); await rejected
  expect(b.owner.isVisible()).toBe(true)
  expect(mockMethod(b.owner.webContents, 'send')).toHaveBeenCalledWith(VOICE_WINDOW_IPC.action, 'unavailable')
  expect(b.report).toHaveBeenCalled()
})

it('ends hidden audio before application shutdown and leaves no registered control handlers', async () => {
  const b = fixture()
  await b.invoke(VOICE_WINDOW_IPC.publish, state)
  await b.invoke(VOICE_WINDOW_IPC.minimize)
  app.emit('before-quit', {})
  expect(mockMethod(b.owner.webContents, 'send')).toHaveBeenCalledWith(VOICE_WINDOW_IPC.action, 'end')
  expect(electron.windows[1]!.isDestroyed()).toBe(true)
  b.controls.dispose()
  expect(electron.handlers.size).toBe(0)
})

it('publishes only audio controls and rejects unknown phases or oversized labels', () => {
  expect(parseDesktopVoiceState({ ...state, sessionTitle: 'private', tasks: ['private'] })).toEqual(state)
  expect(() => parseDesktopVoiceState({ ...state, phase: 'idle' })).toThrow('Invalid desktop voice state')
  expect(() => parseDesktopVoiceState({ ...state, labels: { ...state.labels, status: 'x'.repeat(513) } })).toThrow('Invalid desktop voice label')
})
