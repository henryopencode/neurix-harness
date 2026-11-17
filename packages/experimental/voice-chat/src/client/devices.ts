/** Browser input preferences and permission-scoped device discovery. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { VoiceAudioError } from './audio.ts'

/** An empty id follows the system microphone; labels are browser-provided names. */
export interface VoiceInputDevice { readonly id: string; readonly label: string }

/** Device discovery never acquires a microphone unless the user requests access. */
export interface VoiceDevices {
  readonly devices: readonly VoiceInputDevice[]
  readonly pending: boolean
  readonly error: 'permission' | 'device' | 'unsupported' | null
}

/**
 * Restore the browser's realtime voice input preference.
 * @returns a validated, persisted selection independent of dictation settings.
 */
export function createVoiceInputDevice(): SnapshotStore<VoiceInputDevice> {
  const store = createSnapshotStore<VoiceInputDevice>({ id: '', label: '' }, { persist: { name: 'dsh.voice-chat.microphone' } })
  const saved: unknown = store.getSnapshot()
  if (!saved || typeof saved !== 'object' || !('id' in saved) || typeof saved.id !== 'string'
    || !('label' in saved) || typeof saved.label !== 'string') store.set({ id: '', label: '' })
  return store
}

/**
 * Discover inputs, releasing permission-check capture before returning or rejecting.
 * A late permission result is released even after cancellation.
 * @param requestAccess - whether the user requested a microphone permission check.
 * @param deviceId - input to check; empty follows the system default.
 * @param signal - owning UI plugin lifetime.
 * @returns physical inputs and the separate communications input, without a duplicate system default.
 */
export async function discoverVoiceInputs(
  requestAccess: boolean, deviceId: string, signal: AbortSignal,
): Promise<readonly VoiceInputDevice[]> {
  signal.throwIfAborted()
  const media = (navigator as Partial<Navigator>).mediaDevices
  if (!media) throw new VoiceAudioError('unsupported')
  let stream: MediaStream | undefined
  try {
    if (requestAccess) stream = await media.getUserMedia({ audio: deviceId === '' ? true : { deviceId: { exact: deviceId } }, video: false })
    signal.throwIfAborted()
    const devices = await media.enumerateDevices()
    signal.throwIfAborted()
    return devices.filter(device => device.kind === 'audioinput' && device.deviceId !== '' && device.deviceId !== 'default')
      .map(device => ({ id: device.deviceId, label: device.label }))
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof VoiceAudioError) throw error
    if (error instanceof DOMException && error.name === 'NotAllowedError') throw new VoiceAudioError('permission')
    throw new VoiceAudioError('device')
  } finally { for (const track of stream?.getTracks() ?? []) track.stop() }
}
