/** The real optional composition keeps preparation explicit and preserves normal Session replay. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { fixtureUserPrompts, launchWebScaffold, webSnapshotMode, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const fixture = fileURLToPath(new URL('../../../snapshots/web/voice-chat/session.v4.jsonl', import.meta.url))
const bundle = fileURLToPath(new URL('../../../packages/experimental/voice-chat-bundle', import.meta.url))
const cachedModel = process.env.DSH_VOICE_MODEL_CACHE

it.skipIf(webSnapshotMode() === 'record')('opens local voice setup without recording or downloading and retains ordinary recorded chat', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-voice-chat-browser-'))
  const resources: { scaffold?: WebScaffold; browser?: Browser } = {}
  onTestFinished(async () => {
    try { await resources.browser?.close() } finally {
      try { await resources.scaffold?.close() } finally { await rm(scratch, { recursive: true, force: true }) }
    }
  })
  const overlay = join(scratch, 'voice.patch.yml')
  const dataRoot = cachedModel ?? join(scratch, 'voice-cache')
  const prompt = fixtureUserPrompts(await readFile(fixture, 'utf8'))[0]!
  await writeFile(overlay, `- id: speech-to-text-sensevoice\n  disabled: true\n- id: voice-chat\n  config:\n    dataRoot: ${JSON.stringify(dataRoot)}\n`)
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: bundle, enabled: true }] },
    extraOverlayPath: overlay, replayFixture: fixture })
  resources.scaffold = scaffold
  if (cachedModel) {
    await scaffold.ctx.plugin({ inject: ['speechToText'], apply(ctx) {
      ctx.effect(() => ctx.speechToText.register({
        info: { id: 'sensevoice-local' as SpeechProviderId, name: 'Recorded recognizer', location: 'host-local', languages: ['auto'] },
        transcribe: async (input) => {
          expect(Buffer.from(input.audio).subarray(0, 4).toString()).toBe('RIFF')
          expect(input.audio.length).toBeGreaterThan(32000)
          return { text: prompt, audioSeconds: input.audio.length / 32000, inferenceSeconds: 0.1 }
        },
      }))
    } })
  }
  let prompts = 0
  scaffold.ctx.on('session/event', (_session, event) => { if (event.type === 'user/message' && event.data.source.kind === 'user') prompts++ })
  const browser = await chromium.launch()
  resources.browser = browser
  const page = await newEnglishPage(browser), console = watchConsole(page)
  const review = await mkdtemp(join(tmpdir(), 'dsh-voice-chat-review-'))
  await page.addInitScript((withVoice: boolean) => {
    if (!withVoice) {
      navigator.mediaDevices.getUserMedia = async () => { throw new Error('Opening setup must not acquire a microphone') }
      return
    }
    const holder = window as Window & { voiceTestSpeak?: () => void; voiceTestPlaybackCount?: number; voiceTestTracks?: MediaStreamTrack[] }
    holder.voiceTestPlaybackCount = 0
    AudioContext.prototype.createBufferSource = function () {
      const source = BaseAudioContext.prototype.createBufferSource.call(this), start = source.start.bind(source)
      source.start = (when, offset, duration) => { holder.voiceTestPlaybackCount!++; start(when, offset, duration) }
      return source
    }
    const context = new AudioContext({ sampleRate: 16000 }), oscillator = context.createOscillator()
    const gain = context.createGain(), destination = context.createMediaStreamDestination()
    gain.gain.value = 0; oscillator.connect(gain); gain.connect(destination); oscillator.start()
    holder.voiceTestSpeak = () => {
      gain.gain.setValueAtTime(0.2, context.currentTime)
      gain.gain.setValueAtTime(0, context.currentTime + 0.8)
    }
    navigator.mediaDevices.getUserMedia = async () => {
      await context.resume(); holder.voiceTestTracks = destination.stream.getTracks(); return destination.stream
    }
  }, cachedModel !== undefined)
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const voiceEntry = page.getByRole('button', { name: 'Voice chat', exact: true })
  if (cachedModel) await page.locator('[data-voice-ready="true"]').waitFor({ timeout: 90_000 })
  await voiceEntry.click()
  const panel = page.locator(cachedModel ? '[data-voice-chat]' : '[data-voice-chat-settings]')
  await panel.waitFor()
  expect(prompts).toBe(0)
  for (const [width, theme] of [[1280, 'light'], [420, 'dark']] as const) {
    if (width === 420) await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ colorScheme: theme })
    const rectangle = await panel.boundingBox()
    expect(rectangle).not.toBeNull()
    expect(rectangle!.x).toBeGreaterThanOrEqual(0)
    expect(rectangle!.x + rectangle!.width).toBeLessThanOrEqual(width)
    if (cachedModel) {
      const composer = await page.locator('[data-composer-card]').boundingBox()
      expect(Math.abs(rectangle!.x - composer!.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(rectangle!.width - composer!.width)).toBeLessThanOrEqual(1)
      expect(await panel.getByRole('button', { name: 'End conversation', exact: true }).isVisible()).toBe(true)
    } else await panel.getByRole('combobox', { name: 'Input device', exact: true }).waitFor()
    await page.screenshot({ path: join(review, `${width}-${theme}.png`) })
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  if (!cachedModel) {
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
    await page.getByRole('button', { name: 'New session', exact: true }).filter({ hasText: 'New Session' }).click()
  }
  const input = page.locator('[data-composer-input]')
  const settled = scaffold.whenTurnSettled(120_000)
  if (cachedModel) {
    await page.locator('[data-voice-chat="listening"]').waitFor({ timeout: 90_000 })
    await page.screenshot({ path: join(review, 'ready.png') })
    await page.evaluate(() => { (window as Window & { voiceTestSpeak?: () => void }).voiceTestSpeak?.() })
    await page.locator('[data-voice-chat="recording"]').waitFor()
    await page.screenshot({ path: join(review, 'recording.png') })
  } else {
    await input.fill(prompt); await input.press('Enter')
  }
  await settled
  await page.getByText('DONE', { exact: true }).waitFor()
  expect(prompts).toBe(1)
  if (cachedModel) {
    await page.waitForFunction(() => ((window as Window & { voiceTestPlaybackCount?: number }).voiceTestPlaybackCount ?? 0) > 0,
      undefined, { timeout: 90_000 })
    await page.screenshot({ path: join(review, 'playback.png') })
    const voiceBox = await panel.boundingBox(), composerBox = await page.locator('[data-composer-card]').boundingBox()
    expect(Math.abs(voiceBox!.x - composerBox!.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(voiceBox!.width - composerBox!.width)).toBeLessThanOrEqual(1)
    await panel.getByRole('button', { name: 'End conversation', exact: true }).click()
    expect(await page.evaluate(() => (window as Window & { voiceTestTracks?: MediaStreamTrack[] }).voiceTestTracks
      ?.every(track => track.readyState === 'ended'))).toBe(true)
  }
  if (cachedModel) {
    await panel.getByRole('button', { name: 'Close voice chat', exact: true }).click()
    await expect.poll(() => panel.count()).toBe(0)
  }
  expect(console.pageErrors).toEqual([])
  process.stdout.write(`Voice chat UI evidence: ${review}\n`)
})
