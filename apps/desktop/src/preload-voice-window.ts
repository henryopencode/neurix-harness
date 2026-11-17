/** The compact voice document can observe audio state and route only fixed control actions. */
import { contextBridge, ipcRenderer } from 'electron'
import { VOICE_WINDOW_IPC, parseVoiceWindowSnapshot, type VoiceWindowApi } from './voice-window-protocol.ts'

if (location.protocol === 'dsh-app:' && location.hostname === 'voice' && process.isMainFrame) {
  const api: VoiceWindowApi = {
    state: async () => parseVoiceWindowSnapshot(await ipcRenderer.invoke(VOICE_WINDOW_IPC.state)),
    command: command => ipcRenderer.invoke(VOICE_WINDOW_IPC.command, command) as Promise<void>,
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, input: unknown): void => {
        try { listener(parseVoiceWindowSnapshot(input)) }
        catch (error) {
          console.error('Desktop voice state failed', error)
          for (const command of ['restore', 'end'] as const) {
            void api.command(command).catch((failure: unknown) => { console.error('Desktop voice recovery failed', failure) })
          }
        }
      }
      ipcRenderer.on(VOICE_WINDOW_IPC.changed, receive)
      return () => { ipcRenderer.off(VOICE_WINDOW_IPC.changed, receive) }
    },
  }
  contextBridge.exposeInMainWorld('dshVoiceWindow', api)
}
