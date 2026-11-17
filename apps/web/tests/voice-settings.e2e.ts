/** Plugin configuration and composer actions share one audio owner, including desktop control projection. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFinished, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-voice-chat'
import type { VoiceStatus } from '@deepseek-ai/dsh-voice-chat/types'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type { SpeechPreparationState, SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, selectField } from './support.ts'

interface VoiceSettingsProof {
  captures: MediaStreamConstraints[]
  tracks: MediaStreamTrack[]
  states: object[]
  minimize: number
  gains: GainNode[]
}
declare global {
  interface Window {
    dshVoiceSettingsProof: VoiceSettingsProof
    dshVoiceSettingsAction?: (command: string) => void
    dshVoiceSettingsHidden?: (hidden: boolean) => void
  }
}

const bundle = fileURLToPath(new URL('../../../packages/experimental/voice-chat-bundle', import.meta.url))
const expected = fileURLToPath(new URL('./expected/voice-settings', import.meta.url))

it.each([true, false])('configures voice and keeps one recording lifetime with native controls=%s', async (nativeControls) => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-voice-settings-'))
  const resources: { scaffold?: WebScaffold; browser?: Browser } = {}
  const warmed = Promise.withResolvers<undefined>()
  onTestFinished(async () => {
    warmed.resolve(undefined)
    try { await resources.browser?.close() } finally {
      try { await resources.scaffold?.close() } finally { await rm(scratch, { recursive: true, force: true }) }
    }
  })
  const overlay = join(scratch, 'voice.yml')
  await writeFile(overlay, `- id: speech-to-text-sensevoice\n  disabled: true\n- id: voice-chat\n  config:\n    dataRoot: ${JSON.stringify(join(scratch, 'models'))}\n`)
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: bundle, enabled: true }] }, extraOverlayPath: [fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)), overlay] })
  resources.scaffold = scaffold
  const voiceListeners = new Set<() => void>(), recognitionListeners = new Set<() => void>()
  let voice: VoiceStatus = { phase: 'unprepared', model: 'mlx-4bit', operation: null, completedBytes: 0,
    downloadBytes: 3_000_000_000, hardware: { platform: 'darwin', architecture: 'arm64', memoryBytes: 16 * 1024 ** 3 } }
  let recognition: SpeechPreparationState = { phase: 'unprepared' }
  const updateVoice = (patch: Partial<VoiceStatus>): void => {
    voice = { ...voice, ...patch }; for (const listener of voiceListeners) listener()
  }
  const updateRecognition = (state: SpeechPreparationState): void => {
    recognition = state; for (const listener of recognitionListeners) listener()
  }
  const prepare = vi.spyOn(scaffold.ctx.voiceChat, 'prepare').mockImplementation(() => {
    updateVoice({ phase: 'preparing', operation: 'python', error: undefined, failedStep: undefined })
  })
  const cancel = vi.spyOn(scaffold.ctx.voiceChat, 'cancelPreparation').mockImplementation(async () => {
    updateVoice({ phase: 'unprepared', operation: null })
  })
  const follow = vi.spyOn(scaffold.ctx.voiceChat, 'follow').mockImplementation(async function* (signal) {
    while (!signal.aborted) {
      const change = Promise.withResolvers<undefined>(), wake = (): void => { change.resolve(undefined) }
      voiceListeners.add(wake); signal.addEventListener('abort', wake, { once: true })
      try { yield voice; await change.promise }
      finally { voiceListeners.delete(wake); signal.removeEventListener('abort', wake) }
    }
  })
  const synthesize = vi.spyOn(scaffold.ctx.voiceChat, 'synthesize').mockImplementation(async function* () {
    await warmed.promise
    yield { pcmBase64: 'AAAAAA==', sampleRate: 24000 }
  })
  onTestFinished(() => { prepare.mockRestore(); cancel.mockRestore(); follow.mockRestore(); synthesize.mockRestore() })
  await scaffold.ctx.plugin({ inject: ['speechToText'], apply(ctx) {
    ctx.effect(() => ctx.speechToText.register({
      info: { id: 'sensevoice-local' as SpeechProviderId, name: 'Fixture recognizer', location: 'host-local', languages: ['auto', 'zh', 'en'] },
      preparation: { snapshot: () => recognition,
        subscribe: (listener) => { recognitionListeners.add(listener); return () => { recognitionListeners.delete(listener) } },
        prepare: () => { updateRecognition({ phase: 'loading', startedAt: Date.now() }) },
        cancel: async () => { updateRecognition({ phase: 'cancelled' }) } },
      transcribe: async () => ({ text: '', audioSeconds: 0, inferenceSeconds: 0 }),
    }))
  } })
  const browser = await chromium.launch(); resources.browser = browser
  const page = await newEnglishPage(browser), consoleWatch = watchConsole(page)
  const review = await mkdtemp(join(tmpdir(), 'dsh-voice-settings-review-'))
  await page.addInitScript((withNative: boolean) => {
    const proof: VoiceSettingsProof = { captures: [], tracks: [], states: [], minimize: 0, gains: [] }
    window.dshVoiceSettingsProof = proof
    AudioContext.prototype.createGain = function () {
      const node = BaseAudioContext.prototype.createGain.call(this); proof.gains.push(node); return node
    }
    let hidden = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    window.dshVoiceSettingsHidden = (value) => { hidden = value; document.dispatchEvent(new Event('visibilitychange')) }
    if (withNative) Object.defineProperty(window, 'dshDesktop', { configurable: true, value: { voice: {
      publish: async (state: object | null) => { proof.states.push(state ?? {}) },
      minimize: async () => { proof.minimize++ },
      subscribe: (listener: (command: string) => void) => {
        window.dshVoiceSettingsAction = listener
        return () => { delete window.dshVoiceSettingsAction }
      },
    } } })
    navigator.mediaDevices.enumerateDevices = async () => [
      { deviceId: 'usb', label: 'USB microphone', kind: 'audioinput', groupId: 'usb', toJSON: () => ({}) },
    ]
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      proof.captures.push(constraints ?? {})
      const context = new AudioContext(), destination = context.createMediaStreamDestination()
      await context.resume()
      proof.tracks.push(...destination.stream.getTracks())
      window.addEventListener('pagehide', () => { void context.close() }, { once: true })
      return destination.stream
    }
  }, nativeControls)
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const primary = page.getByRole('button', { name: 'Voice chat', exact: true })
  await primary.waitFor()
  expect(await primary.textContent()).toBe('')
  const input = page.locator('[data-composer-input]')
  await input.fill('draft')
  expect(await primary.count()).toBe(0)
  await page.getByRole('button', { name: 'Send message', exact: true }).waitFor()
  await input.fill('')
  await primary.click()
  const settings = page.locator('[data-voice-chat-settings]')
  await settings.waitFor()
  await settings.getByRole('combobox', { name: 'Recognition service', exact: true }).waitFor()
  expect(await page.evaluate(() => window.dshVoiceSettingsProof.captures.length)).toBe(0)
  expect(prepare).not.toHaveBeenCalled()
  await selectField(settings.getByRole('combobox', { name: 'Input device', exact: true }), 'usb')
  await selectField(settings.getByRole('combobox', { name: 'Recognition language', exact: true }), 'zh')
  await selectField(settings.getByRole('combobox', { name: 'Voice', exact: true }), 'calm')
  expect(synthesize).not.toHaveBeenCalled()
  await settings.getByRole('button', { name: 'Check microphone', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.dshVoiceSettingsProof.captures.length)).toBe(1)
  await expect.poll(() => page.evaluate(() => window.dshVoiceSettingsProof.tracks.every(track => track.readyState === 'ended'))).toBe(true)
  for (const [width, dark] of [[1280, false], [390, true]] as const) {
    if (width === 390) await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    await page.setViewportSize({ width, height: 1000 })
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
    await expect.poll(async () => {
      const bounds = await settings.boundingBox()
      return bounds !== null && bounds.x >= 0 && bounds.x + bounds.width <= width
    }).toBe(true)
    await page.screenshot({ path: join(review, `settings-${width}.png`) })
  }
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await compareOrRefreshGolden(join(expected, 'unprepared.expected.md'), await captureStableAria(page, '[data-voice-chat-settings]', scaffold.workspaceCwd), webSnapshotMode())
  await settings.getByRole('button', { name: 'Download and prepare', exact: true }).click()
  await settings.getByText('Preparing private Python…', { exact: true }).waitFor()
  await settings.getByRole('button', { name: 'Cancel preparation', exact: true }).click()
  await expect.poll(() => cancel.mock.calls.length).toBe(1)
  updateVoice({ phase: 'failed', operation: null, error: 'runtime', failedStep: 'dependencies' })
  await settings.getByRole('alert').filter({ hasText: 'Speech dependency installation failed' }).waitFor()
  await settings.getByRole('button', { name: 'Prepare again', exact: true }).click()
  await expect.poll(() => prepare.mock.calls.length).toBe(2)
  updateRecognition({ phase: 'standby' }); updateVoice({ phase: 'ready', operation: null, error: undefined, failedStep: undefined })
  await settings.getByText('Local resources are ready and wake when a conversation starts', { exact: true }).waitFor()
  await compareOrRefreshGolden(join(expected, 'ready.expected.md'), await captureStableAria(page, '[data-voice-chat-settings]', scaffold.workspaceCwd), webSnapshotMode())
  await page.getByRole('button', { name: 'New session', exact: true }).filter({ hasText: 'New Session' }).click()
  const beforeVoice = await page.locator('[data-composer-card]').boundingBox()
  await primary.click()
  await page.locator('[data-voice-chat="warming"]').waitFor()
  await page.locator('[data-voice-orb="warming"]').waitFor()
  expect(await page.evaluate(() => window.dshVoiceSettingsProof.tracks.at(-1)?.enabled)).toBe(false)
  expect(await page.locator('[data-composer-card]').boundingBox()).toEqual(beforeVoice)
  expect(synthesize.mock.calls[0]?.[0]).toMatchObject({ voice: 'calm' })
  await page.screenshot({ path: join(review, 'preparing-voice.png') })
  warmed.resolve(undefined)
  await page.locator('[data-voice-chat="listening"]').waitFor()
  const orb = page.locator('[data-voice-orb="listening"]')
  const orbBounds = await orb.boundingBox()
  await page.mouse.move(orbBounds!.x + orbBounds!.width * 0.8, orbBounds!.y + orbBounds!.height * 0.4)
  expect(await orb.evaluate(element => Number.parseFloat(getComputedStyle(element).getPropertyValue('--voice-gaze-x')))).toBeGreaterThan(0)
  expect(await page.locator('[data-voice-chat] [aria-label="Transcript"]').count()).toBe(0)
  await compareOrRefreshGolden(join(expected, nativeControls ? 'listening-native.expected.md' : 'listening.expected.md'),
    await captureStableAria(page, '[data-voice-chat]', scaffold.workspaceCwd), webSnapshotMode())
  for (const [width, theme] of [[1280, 'light'], [390, 'dark']] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme: theme })
    const dialog = await page.getByRole('dialog', { name: 'Voice chat', exact: true }).boundingBox()
    expect(dialog!.x).toBeGreaterThanOrEqual(0)
    expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(width)
    await page.screenshot({ path: join(review, `companion-${width}-${theme}.png`) })
  }
  await page.setViewportSize({ width: 1280, height: 1000 })
  const minimized = page.getByRole('button', { name: nativeControls ? 'Minimize voice window' : 'Minimize voice panel', exact: true })
  await minimized.click()
  if (nativeControls) {
    await page.evaluate(() => { window.dshVoiceSettingsHidden?.(true) })
    expect(await page.locator('[data-voice-chat="listening"]').count()).toBe(1)
    await page.evaluate(() => { window.dshVoiceSettingsAction?.('microphone') })
  } else {
    const floating = page.locator('[data-voice-floating]')
    await floating.waitFor()
    expect(await floating.getByText(/running sessions/i).count()).toBe(0)
    await floating.getByRole('button', { name: 'Mute microphone', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Unmute microphone', exact: true }).waitFor()
  expect(await page.evaluate(() => window.dshVoiceSettingsProof.tracks.at(-1)?.enabled)).toBe(false)
  if (nativeControls) {
    await page.evaluate(() => { window.dshVoiceSettingsAction?.('speaker') })
  } else await page.locator('[data-voice-floating]').getByRole('button', { name: 'Mute speaker', exact: true }).click()
  await page.getByRole('button', { name: 'Unmute speaker', exact: true }).waitFor()
  expect(await page.evaluate(() => window.dshVoiceSettingsProof.gains.at(-1)?.gain.value)).toBe(0)
  expect(await page.evaluate(() => window.dshVoiceSettingsProof.captures.length)).toBe(2)
  await page.screenshot({ path: join(review, nativeControls ? 'active-native-projection.png' : 'active-web-floating.png') })
  if (nativeControls) {
    await page.evaluate(() => { window.dshVoiceSettingsAction?.('end') })
  } else {
    await page.getByRole('button', { name: 'Expand voice panel', exact: true }).click()
    expect(await page.locator('[data-voice-floating]').count()).toBe(0)
    await minimized.click()
    await page.locator('[data-voice-floating]').getByRole('button', { name: 'End conversation', exact: true }).click()
  }
  await expect.poll(() => page.evaluate(() => window.dshVoiceSettingsProof.tracks.every(track => track.readyState === 'ended'))).toBe(true)
  expect(consoleWatch.pageErrors).toEqual([])
  process.stdout.write(`Voice plugin settings and controls evidence: ${review}\n`)
}, 120_000)
