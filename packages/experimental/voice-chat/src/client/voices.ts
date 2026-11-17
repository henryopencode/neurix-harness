/** Browser-owned voice preference; each conversation captures its selection at startup. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { VoicePreset } from '../types.ts'

/**
 * Restore the selected built-in voice, replacing an invalid saved value with the Host default.
 * @param initial - deployment-selected voice for a browser without a saved preference.
 * @returns the persisted browser selection; no model is loaded or downloaded.
 */
export function createVoicePreference(initial: VoicePreset): SnapshotStore<VoicePreset> {
  const store = createSnapshotStore<VoicePreset>(initial, { persist: { name: 'dsh.voice-chat.voice' } })
  const saved: unknown = store.getSnapshot()
  if (saved !== 'natural' && saved !== 'warm' && saved !== 'calm') store.set(initial)
  return store
}
