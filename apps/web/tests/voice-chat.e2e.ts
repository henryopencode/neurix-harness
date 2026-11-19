/** The optional composition keeps preparation explicit and preserves normal Session replay. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFinished, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-voice-chat'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { fixtureUserPrompts, launchWebScaffold, webSnapshotMode, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const fixture = fileURLToPath(new URL('../../../snapshots/web/voice-chat/session.v4.jsonl', import.meta.url))
const bundle = fileURLToPath(new URL('../../../packages/experimental/voice-chat-bundle', import.meta.url))

it.skipIf(webSnapshotMode() === 'record')('opens setup without recording, then overlays a completed recorded conversation', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-voice-chat-browser-'))
  const resources: { scaffold?: WebScaffold; browser?: Browser } = {}
  onTestFinished(async () => {
    try { await resources.browser?.close() } finally {
      try { await resources.scaffold?.close() } finally { await rm(scratch, { recursive: true, force: true }) }
    }
  })
  const overlay = join(scratch, 'voice.patch.yml')
  const prompt = fixtureUserPrompts(await readFile(fixture, 'utf8'))[0]!
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
    yield { pcmBase64: 'AAAAAA==', sampleRate: 24000 }
  })
  onTestFinished(() => { follow.mockRestore(); synthesize.mockRestore() })
  let prompts = 0
  scaffold.ctx.on('session/event', (_session, event) => { if (event.type === 'user/message' && event.data.source.kind === 'user') prompts++ })
  const browser = await chromium.launch()
  resources.browser = browser
  const page = await newEnglishPage(browser), console = watchConsole(page)
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => { throw new Error('Opening setup must not acquire a microphone') }
  })
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  await page.getByRole('button', { name: 'Voice chat', exact: true }).click()
  await page.locator('[data-voice-chat-settings]').getByRole('combobox', { name: 'Input device', exact: true }).waitFor()
  expect(prompts).toBe(0)
  await page.getByRole('button', { name: 'New session', exact: true }).filter({ hasText: 'New Session' }).click()
  const input = page.locator('[data-composer-input]')
  const settled = scaffold.whenTurnSettled(120_000)
  await input.fill(prompt); await input.press('Enter')
  await settled
  await page.getByText('DONE', { exact: true }).waitFor()
  expect(prompts).toBe(1)
  await scaffold.ctx.plugin({ inject: ['speechToText'], apply(ctx) {
    ctx.effect(() => ctx.speechToText.register({
      info: { id: 'sensevoice-local' as SpeechProviderId, name: 'Fixture recognizer', location: 'host-local', languages: ['auto'] },
      transcribe: async () => ({ text: '', audioSeconds: 0, inferenceSeconds: 0 }),
    }))
  } })
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new AudioContext()
      const silence = audio.createMediaStreamDestination()
      await audio.resume()
      window.addEventListener('pagehide', () => { void audio.close() }, { once: true })
      return silence.stream
    }
  })
  const open = page.locator('[data-voice-ready="true"]')
  await open.waitFor()
  const card = page.locator('[data-composer-card]')
  const baseline = await card.boundingBox()
  await open.click()
  const orb = page.locator('[data-voice-orb="listening"]')
  await orb.waitFor()
  expect(await card.boundingBox()).toEqual(baseline)
  expect(await page.getByText('DONE', { exact: true }).isVisible()).toBe(true)
  await page.getByRole('button', { name: 'End conversation', exact: true }).click()
  await open.waitFor()
  expect(prompts).toBe(1)
  expect(console.pageErrors).toEqual([])
})
