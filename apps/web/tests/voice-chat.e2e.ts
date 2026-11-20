/** The optional composition keeps preparation explicit and preserves normal Session replay. */
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFinished, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-voice-chat'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { fixtureUserPrompts, launchWebScaffold, webSnapshotMode, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const fixture = fileURLToPath(new URL('../../../snapshots/web/voice-chat/session.v4.jsonl', import.meta.url))
const bundle = fileURLToPath(new URL('../../../packages/experimental/voice-chat-bundle', import.meta.url))

it.skipIf(webSnapshotMode() === 'record')('shows a pending caption, submits a spoken turn and recovers an unconfirmed transcript', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-voice-chat-browser-'))
  const resources: { scaffold?: WebScaffold; browser?: Browser } = {}
  const warmup = Promise.withResolvers<undefined>()
  const admission = Promise.withResolvers<undefined>(), receipt = Promise.withResolvers<undefined>()
  onTestFinished(async () => {
    warmup.resolve(undefined); admission.resolve(undefined); receipt.resolve(undefined)
    try { await resources.browser?.close() } finally {
      try { await resources.scaffold?.close() } finally { await rm(scratch, { recursive: true, force: true }) }
    }
  })
  const overlay = join(scratch, 'voice.patch.yml')
  const prompt = fixtureUserPrompts(await readFile(fixture, 'utf8'))[0]!
  let nextTranscript = prompt
  await writeFile(overlay, `- id: speech-to-text-sensevoice\n  disabled: true\n- id: voice-chat\n  config:\n    dataRoot: ${JSON.stringify(join(scratch, 'voice-cache'))}\n`)
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: bundle, enabled: true }] },
    extraOverlayPath: [fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)), overlay], replayFixture: fixture })
  resources.scaffold = scaffold
  const follow = vi.spyOn(scaffold.ctx.voiceChat, 'follow').mockImplementation(async function* (signal) {
    const cancelled = Promise.withResolvers<undefined>(), stop = (): void => { cancelled.resolve(undefined) }
    signal.addEventListener('abort', stop, { once: true })
    try {
      yield { phase: 'ready', model: 'mlx-4bit', operation: null, completedBytes: 0, downloadBytes: 3e9,
        hardware: { platform: 'darwin', architecture: 'arm64', memoryBytes: 16 * 1024 ** 3 } }
      if (!signal.aborted) await cancelled.promise
    } finally { signal.removeEventListener('abort', stop) }
  })
  const synthesize = vi.spyOn(scaffold.ctx.voiceChat, 'synthesize').mockImplementation(async function* () {
    await warmup.promise
    yield { pcmBase64: 'AAAAAA==', sampleRate: 24000 }
  })
  const send = scaffold.ctx.sessionController.prompt.bind(scaffold.ctx.sessionController)
  const sending = vi.spyOn(scaffold.ctx.sessionController, 'prompt')
    .mockImplementationOnce(async (request, signal) => {
      await admission.promise
      const result = await send(request, signal)
      await receipt.promise
      return result
    })
    .mockImplementationOnce(async (request, signal) => {
      if (!signal.aborted) await once(signal, 'abort')
      return send(request, signal)
    })
  onTestFinished(() => { follow.mockRestore(); synthesize.mockRestore(); sending.mockRestore() })
  let prompts = 0
  scaffold.ctx.on('session/event', (_session, event) => { if (event.type === 'user/message' && event.data.source.kind === 'user') prompts++ })
  const browser = await chromium.launch()
  resources.browser = browser
  const page = await newEnglishPage(browser), console = watchConsole(page)
  page.setDefaultTimeout(30_000)
  await scaffold.ctx.plugin({ inject: ['speechToText'], apply(ctx) {
    ctx.effect(() => ctx.speechToText.register({
      info: { id: 'sensevoice-local' as SpeechProviderId, name: 'Fixture recognizer', location: 'host-local', languages: ['auto'] },
      transcribe: async () => ({ text: nextTranscript, audioSeconds: 1, inferenceSeconds: 0 }),
    }))
  } })
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new AudioContext()
      const input = audio.createMediaStreamDestination()
      document.addEventListener('voice-fixture-speech', () => {
        const source = new OscillatorNode(audio, { frequency: 440 })
        source.connect(new GainNode(audio, { gain: 0.2 })).connect(input)
        source.start(); source.stop(audio.currentTime + 0.7)
      }, { once: true })
      window.addEventListener('pagehide', () => { void audio.close() }, { once: true })
      await audio.resume()
      return input.stream
    }
  })
  try {
    await page.goto(scaffold.authenticatedUrl)
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const open = page.locator('[data-voice-ready="true"]')
    await open.waitFor()
    const card = page.locator('[data-composer-card]')
    const baseline = await card.boundingBox()
    await open.click()
    const orb = page.locator('[data-voice-orb="listening"]')
    await orb.waitFor()
    expect(await card.boundingBox()).toEqual(baseline)
    const speak = () => page.evaluate(() => { document.dispatchEvent(new Event('voice-fixture-speech')) })
    await speak()
    const caption = page.locator('[data-voice-caption]').filter({ hasText: prompt })
    await caption.waitFor()
    expect(prompts).toBe(0)
    expect(await page.getByText(prompt, { exact: true }).count()).toBe(1)
    expect(await card.boundingBox()).toEqual(baseline)
    const review = process.env.DSH_VOICE_REVIEW_DIR
    if (review) await page.screenshot({ path: join(review, 'voice-caption-light.png') })
    const viewport = page.viewportSize()!
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    await page.setViewportSize({ width: 390, height: viewport.height })
    await page.emulateMedia({ colorScheme: 'dark' })
    const bounds = (await caption.boundingBox())!
    const voiceBounds = (await page.locator('[data-voice-orb]:not([data-voice-orb-hidden])').boundingBox())!
    expect(bounds.width).toBeGreaterThan(0)
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
    expect(bounds.y + bounds.height).toBeLessThan(voiceBounds.y)
    await page.getByRole('button', { name: 'End conversation', exact: true }).click({ trial: true })
    if (review) await page.screenshot({ path: join(review, 'voice-caption-dark-390.png') })
    await page.setViewportSize(viewport)
    const settled = scaffold.whenTurnSettled(120_000)
    admission.resolve(undefined)
    await settled
    await caption.waitFor({ state: 'detached' })
    await page.getByText('DONE', { exact: true }).waitFor()
    expect(prompts).toBe(1)
    receipt.resolve(undefined)
    warmup.resolve(undefined)
    await orb.waitFor()
    await page.getByRole('button', { name: 'End conversation', exact: true }).click()
    await open.waitFor()
    await open.click()
    await orb.waitFor()
    expect(await page.getByText('DONE', { exact: true }).isVisible()).toBe(true)
    nextTranscript = 'Keep this unfinished message.'
    await speak()
    await page.locator('[data-voice-caption]').filter({ hasText: nextTranscript }).waitFor()
    if (review) await page.screenshot({ path: join(review, 'voice-caption-docked.png') })
    await page.getByRole('button', { name: 'End conversation', exact: true }).click()
    const insert = page.getByRole('button', { name: 'Insert into draft', exact: true })
    await insert.waitFor()
    if (review) await page.screenshot({ path: join(review, 'voice-caption-recovery.png') })
    await insert.click()
    await insert.waitFor({ state: 'detached' })
    expect(await page.locator('[data-composer-input]').textContent()).toBe(nextTranscript)
    expect(prompts).toBe(1)
    expect(console.pageErrors).toEqual([])
  } catch (error) {
    await saveFailureShot(page, 'voice-chat')
    throw error
  }
})
