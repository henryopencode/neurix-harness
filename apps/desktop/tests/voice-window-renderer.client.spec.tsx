// @vitest-environment jsdom
/** Late initial reads cannot overwrite mute state already pushed to the compact renderer. */
import { act, fireEvent, screen } from '@testing-library/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { DesktopVoiceState } from '@deepseek-ai/dsh-voice-chat/types'
import type { VoiceWindowApi, VoiceWindowSnapshot } from '../src/voice-window-protocol.ts'

it('retains newer audio state and routes only explicit compact control actions', async () => {
  const initial = Promise.withResolvers<VoiceWindowSnapshot>(), command = vi.fn<VoiceWindowApi['command']>(async () => {})
  const unsubscribe = vi.fn()
  let publish: ((snapshot: VoiceWindowSnapshot) => void) | undefined
  const api: VoiceWindowApi = { state: () => initial.promise, command,
    subscribe(listener) { publish = listener; return unsubscribe } }
  const scheme = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.stubGlobal('matchMedia', () => scheme)
  document.body.innerHTML = '<div id="root"></div>'
  const previous = Object.getOwnPropertyDescriptor(window, 'dshVoiceWindow')
  window.dshVoiceWindow = api
  onTestFinished(async () => {
    await act(async () => { window.dispatchEvent(new Event('pagehide')) })
    if (previous) Object.defineProperty(window, 'dshVoiceWindow', previous); else Reflect.deleteProperty(window, 'dshVoiceWindow')
    document.body.replaceChildren(); vi.unstubAllGlobals()
  })
  const state: DesktopVoiceState = { phase: 'listening', microphoneMuted: true, speakerMuted: false,
    labels: { status: 'Microphone muted', muteMicrophone: 'Mute microphone', unmuteMicrophone: 'Unmute microphone',
      muteSpeaker: 'Mute speaker', unmuteSpeaker: 'Unmute speaker', end: 'End conversation', restore: 'Restore window' } }
  await act(async () => { await import('../src/client/voice-window.tsx') })
  await act(async () => { publish?.({ revision: 2, state }) })
  expect(screen.getByRole('button', { name: 'Unmute microphone' }).getAttribute('aria-pressed')).toBe('true')
  await act(async () => { initial.resolve({ revision: 1, state: { ...state, microphoneMuted: false } }) })
  expect(screen.queryByRole('button', { name: 'Mute microphone' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Mute speaker' }))
  fireEvent.click(screen.getByRole('button', { name: 'Restore window' }))
  expect(command.mock.calls).toEqual([['speaker'], ['restore']])
  for (const name of ['Unmute microphone', 'End conversation']) {
    expect(screen.getByRole('button', { name }).querySelector('svg path')).not.toBeNull()
  }
  expect([...document.querySelectorAll('.voice-controls button')].map(button => button.getAttribute('aria-label')))
    .toEqual(['Unmute microphone', 'End conversation', 'Mute speaker'])
  expect(document.body.textContent).not.toMatch(/running sessions/i)
})
