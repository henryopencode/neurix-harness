// @vitest-environment jsdom
/** The selected preset survives browser reloads without starting any audio or download. */
import { afterEach, expect, it } from 'vitest'
import { createVoicePreference } from '../src/client/voices.ts'

afterEach(() => { localStorage.removeItem('dsh.voice-chat.voice') })

it('restores a saved voice instead of the deployment default', () => {
  const preference = createVoicePreference('natural')
  preference.set('calm')
  expect(createVoicePreference('warm').getSnapshot()).toBe('calm')
})

it('replaces an invalid saved voice with the deployment default', () => {
  localStorage.setItem('dsh.voice-chat.voice', JSON.stringify('missing-voice'))
  expect(createVoicePreference('warm').getSnapshot()).toBe('warm')
  expect(createVoicePreference('natural').getSnapshot()).toBe('warm')
})
