/** Plugin configuration and composer actions share one audio owner, including desktop control projection. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFailed, onTestFinished, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-voice-chat'
import type { VoiceStatus } from '@deepseek-ai/dsh-voice-chat/types'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type { SpeechPreparationState, SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot, selectField } from './support.ts'

interface VoiceSettingsProof {
  captures: MediaStreamConstraints[]
  tracks: MediaStreamTrack[]
  states: object[]
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
const dictation = fileURLToPath(new URL('../../../packages/experimental/voice-input-bundle', import.meta.url))
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
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: bundle, enabled: true }, { dir: dictation, enabled: true }] },
    extraOverlayPath: [fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)), overlay] })
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
  onTestFailed(async () => { await saveFailureShot(page, `voice-settings-${nativeControls ? 'desktop' : 'web'}`) })
  const review = await mkdtemp(join(tmpdir(), 'dsh-voice-settings-review-'))
  await page.addInitScript((withNative: boolean) => {
    const proof: VoiceSettingsProof = { captures: [], tracks: [], states: [], gains: [] }
    window.dshVoiceSettingsProof = proof
    AudioContext.prototype.createGain = function () {
      const node = BaseAudioContext.prototype.createGain.call(this); proof.gains.push(node); return node
    }
    let hidden = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    window.dshVoiceSettingsHidden = (value) => { hidden = value; document.dispatchEvent(new Event('visibilitychange')) }
    if (withNative) Object.defineProperty(window, 'dshDesktop', { configurable: true, value: { voice: {
      publish: async (state: object | null) => { proof.states.push(state ?? {}) },
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
  const dictate = page.getByRole('button', { name: 'Start recording', exact: true })
  await primary.waitFor()
  expect(await primary.textContent()).toBe('')
  const input = page.locator('[data-composer-input]')
  await input.fill('draft')
  expect(await primary.count()).toBe(0)
  await page.getByRole('button', { name: 'Send message', exact: true }).waitFor()
  await input.press('ControlOrMeta+A')
  await input.press('Backspace')
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
  const composer = page.locator('[data-composer-card]')
  const headline = page.locator('[data-conversation-hero-intro]')
  const workspace = page.getByRole('button', { name: 'Choose workspace', exact: true })
  await dictate.waitFor()
  await headline.waitFor()
  const beforeVoice = await composer.boundingBox()
  const beforeWorkspace = await workspace.boundingBox()
  await primary.click()
  const listening = page.locator('[data-voice-chat="listening"]')
  await listening.waitFor()
  expect(await page.evaluate(() => window.dshVoiceSettingsProof.tracks.at(-1)?.enabled)).toBe(true)
  const duringVoice = await composer.boundingBox()
  expect(duringVoice?.x).toBe(beforeVoice?.x)
  expect(duringVoice?.y).toBe(beforeVoice?.y)
  expect(duringVoice?.width).toBe(beforeVoice?.width)
  expect(await workspace.boundingBox()).toEqual(beforeWorkspace)
  expect(await listening.getByRole('status').evaluate(
    element => getComputedStyle(element).clipPath)).toBe('inset(50%)')
  expect(await dictate.isVisible()).toBe(false)
  await headline.waitFor({ state: 'hidden' })
  expect(await page.locator('[data-conversation-content-cover]').count()).toBe(0)
  expect(await page.getByRole('dialog', { name: 'Voice chat', exact: true }).count()).toBe(0)
  await expect.poll(() => synthesize.mock.calls[0]?.[0]).toMatchObject({ voice: 'calm' })
  warmed.resolve(undefined)
  const orb = page.locator('[data-voice-orb="listening"]')
  const controls = composer.locator('[data-voice-controls]')
  expect(await page.locator('[data-voice-chat] [aria-label="Transcript"]').count()).toBe(0)
  await compareOrRefreshGolden(join(expected, 'listening.expected.md'),
    await captureStableAria(page, '[data-voice-controls]', scaffold.workspaceCwd), webSnapshotMode())
  for (const [width, theme] of [[1280, 'light'], [390, 'dark']] as const) {
    if (width === 390) await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    const ball = (await orb.boundingBox())!, card = (await composer.boundingBox())!, buttons = (await controls.boundingBox())!
    const project = (await workspace.boundingBox())!
    expect(ball.width).toBe(88)
    expect(Math.abs(ball.x + ball.width / 2 - card.x - card.width / 2)).toBeLessThanOrEqual(1)
    expect(ball.y).toBeGreaterThanOrEqual(0)
    expect(ball.y + ball.height).toBeLessThanOrEqual(project.y)
    expect(project.y + project.height).toBeLessThanOrEqual(card.y)
    expect(buttons.x).toBeGreaterThanOrEqual(card.x)
    expect(buttons.x + buttons.width).toBeLessThanOrEqual(card.x + card.width)
    expect(card.x).toBeGreaterThanOrEqual(0)
    expect(card.x + card.width).toBeLessThanOrEqual(width)
    await input.fill('A draft stays editable with voice chat on.')
    await composer.getByRole('button', { name: 'Send message', exact: true }).waitFor()
    await controls.getByRole('button', { name: 'End conversation', exact: true }).waitFor()
    await page.screenshot({ path: join(review, `voice-${width}-${theme}.png`) })
  }
  if (nativeControls) {
    await page.evaluate(() => { window.dshVoiceSettingsHidden?.(true) })
    expect(await page.locator('[data-voice-chat="listening"]').count()).toBe(1)
    await page.evaluate(() => { window.dshVoiceSettingsAction?.('microphone') })
  } else {
    await controls.getByRole('button', { name: 'Mute microphone', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Unmute microphone', exact: true }).waitFor()
  expect(await page.evaluate(() => window.dshVoiceSettingsProof.tracks.at(-1)?.enabled)).toBe(false)
  if (nativeControls) {
    await page.evaluate(() => { window.dshVoiceSettingsAction?.('speaker') })
  } else await controls.getByRole('button', { name: 'Mute speaker', exact: true }).click()
  await page.getByRole('button', { name: 'Unmute speaker', exact: true }).waitFor()
  expect(await page.evaluate(() => window.dshVoiceSettingsProof.gains.at(-1)?.gain.value)).toBe(0)
  expect(await page.evaluate(() => window.dshVoiceSettingsProof.captures.length)).toBe(2)
  if (nativeControls) {
    await page.evaluate(() => { window.dshVoiceSettingsAction?.('end') })
  } else {
    await page.evaluate(() => { window.dshVoiceSettingsHidden?.(true) })
  }
  await expect.poll(() => page.evaluate(() => window.dshVoiceSettingsProof.tracks.every(track => track.readyState === 'ended'))).toBe(true)
  await dictate.waitFor()
  await headline.waitFor()
  expect(await input.textContent()).toBe('A draft stays editable with voice chat on.')
  expect(consoleWatch.pageErrors).toEqual([])
  process.stdout.write(`Voice plugin settings and controls evidence: ${review}\n`)
}, 120_000)
